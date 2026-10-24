// Auto Arrange: places the parts of a circuit in functional columns and routes
// every wire orthogonally around the part bodies. It only changes geometry
// (positions, rotation of free parts, wire bend points and — on request — wire
// colours). Connectivity is untouched: wires keep their two end pins and parts
// plugged into a breadboard move together with it, so every hole insertion stays.
import { GRID, boundsOf, pinWorld, snap } from './geometry';
import { buildNetlist, type Netlist } from './netlist';
import { getPart, hasPart, pinsOf, withDefaults } from './parts';
import { PI5_HEADER } from './pi5';
import { WIRE_COLORS as W } from './project';
import { segIntersect, simplify, type Pt, type Rect } from './routing';
import type { ComponentInstance, ProjectDoc, Wire, Zone } from './types';

export type Role = 'controller' | 'power' | 'input' | 'interface' | 'display' | 'output' | 'passive' | 'board' | 'model';

const INTERFACE_TYPES = new Set(['relay_module', 'ssr', 'l298n', 'tb6612', 'npn', 'pnp', 'mosfet', 'pc817', 'hc08', 'hc32', 'hc86', 'hc04', 'level_shifter', 'max485', 'usb_serial']);
const DISPLAY_TYPES = new Set(['seven_segment', 'tm1637', 'ws2812_strip']);
const PASSIVE_TYPES = new Set(['resistor', 'capacitor', 'diode', 'terminal_block']);

export const ROLE_LABEL: Record<Role, string> = {
  controller: 'Raspberry Pi controller',
  power: 'Power supply',
  input: 'Input sensors',
  interface: 'Interfaces & drivers',
  display: 'Display',
  output: 'Output actuators',
  passive: 'Passive parts',
  board: 'Breadboard',
  model: 'Farm model',
};
const ROLE_RANK: Record<Role, number> = { controller: 0, board: 1, input: 2, interface: 3, passive: 4, output: 5, display: 6, power: 7, model: 8 };

export function roleOf(type: string): Role {
  if (type === 'rpi5') return 'controller';
  if (type === 'breadboard') return 'board';
  if (!hasPart(type)) return 'passive';
  const m = getPart(type);
  if (pinsOf(m, withDefaults(m, {})).length === 0) return 'model';
  if (PASSIVE_TYPES.has(type)) return 'passive';
  if (INTERFACE_TYPES.has(type)) return 'interface';
  if (DISPLAY_TYPES.has(type) || m.category === 'display') return 'display';
  switch (m.category) {
    case 'power':
      return 'power';
    case 'interface':
      return 'interface';
    case 'sensor':
    case 'input':
      return 'input';
    case 'semiconductor':
      return 'interface';
    case 'passive':
    case 'basic':
      return 'passive';
    default:
      return 'output';
  }
}

// ------------------------------------------------------------------ geometry helpers
const bodyOf = (c: ComponentInstance): Rect => {
  const m = getPart(c.type);
  return boundsOf(c, m.w, m.h);
};

export function pinPoint(doc: { components: ComponentInstance[] }, comp: string, pin: string): Pt | null {
  const c = doc.components.find((x) => x.id === comp);
  if (!c || !hasPart(c.type)) return null;
  const m = getPart(c.type);
  const p = pinsOf(m, withDefaults(m, c.props)).find((x) => x.id === pin);
  return p ? pinWorld(c, p, m.w, m.h) : null;
}

/** nets that carry supply or ground (they connect almost everything and say nothing about signal flow) */
function powerNets(doc: ProjectDoc, net: Netlist): Set<number> {
  const out = new Set<number>();
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  net.nets.forEach((n) => {
    for (const p of n.pins) {
      const c = byId.get(p.comp);
      if (!c || !hasPart(c.type)) continue;
      if (c.type === 'rpi5') {
        const h = PI5_HEADER[Number(p.pin.slice(1)) - 1];
        if (h && h.bcm === null) return out.add(n.id);
        continue;
      }
      if (getPart(c.type).category === 'power') return out.add(n.id);
    }
    const kinds = n.pins
      .map((p) => {
        const c = byId.get(p.comp);
        if (!c || !hasPart(c.type) || c.type === 'breadboard') return null;
        const m = getPart(c.type);
        return pinsOf(m, withDefaults(m, c.props)).find((x) => x.id === p.pin)?.kind ?? null;
      })
      .filter(Boolean);
    if (kinds.length && kinds.every((k) => k === 'power' || k === 'ground')) out.add(n.id);
  });
  return out;
}

interface Node {
  id: string; // cluster id (breadboard id, or the part id)
  members: ComponentInstance[];
  role: Role;
  w: number;
  h: number;
  /** offsets of members from the node's top-left corner */
  offsets: Map<string, Pt>;
  layer: number;
  key: number;
  x: number;
  y: number;
}

const LABEL_SPACE = 28; // component labels are drawn above the body
const V_GAP = 46;
const COL_GAP = 150;
const MAX_COL_H = 960;

export interface ArrangeOptions {
  /** red for supply, black for ground, signal colours by function */
  recolor?: boolean;
  /** labelled functional zones (default: for circuits with 7 or more parts) */
  zones?: boolean;
}

export function arrangeCircuit(doc: ProjectDoc, opts: ArrangeOptions = {}): ProjectDoc {
  const comps = doc.components.filter((c) => hasPart(c.type));
  if (!comps.length) return doc;
  const net = buildNetlist(doc);
  const pnets = powerNets(doc, net);

  // ---- rigid clusters: a breadboard and everything plugged into it
  const clusterOf = new Map<string, string>();
  for (const ins of net.insertions) clusterOf.set(ins.comp, ins.board);
  const nodes = new Map<string, Node>();
  const nodeOf = (id: string) => clusterOf.get(id) ?? id;
  for (const c of comps) {
    const nid = nodeOf(c.id);
    if (!nodes.has(nid)) nodes.set(nid, { id: nid, members: [], role: 'passive', w: 0, h: 0, offsets: new Map(), layer: -1, key: 0, x: 0, y: 0 });
    nodes.get(nid)!.members.push(c);
  }
  // with many header wires the Pi is turned so its 40-pin header faces the parts:
  // pin 1 at the top, pin 40 at the bottom, every wire leaves straight to the right
  const piWires = doc.wires.filter((w) => comps.some((c) => c.type === 'rpi5' && (c.id === w.from.comp || c.id === w.to.comp))).length;
  const piRotation = piWires > 10 ? (90 as const) : (0 as const);
  for (const n of nodes.values()) {
    const free = n.members.length === 1 && !clusterOf.has(n.members[0].id) && n.members[0].type !== 'breadboard';
    const placed = free ? [{ ...n.members[0], rotation: n.members[0].type === 'rpi5' ? piRotation : (0 as const) }] : n.members;
    n.members = placed;
    const bs = placed.map(bodyOf);
    const x0 = Math.min(...bs.map((b) => b.x0));
    const y0 = Math.min(...bs.map((b) => b.y0));
    n.w = Math.max(...bs.map((b) => b.x1)) - x0;
    n.h = Math.max(...bs.map((b) => b.y1)) - y0;
    for (const c of placed) n.offsets.set(c.id, { x: c.x - x0, y: c.y - y0 });
    const board = placed.find((c) => c.type === 'breadboard');
    n.role = board ? 'board' : roleOf(placed[0].type);
  }

  // ---- signal graph between nodes (power and ground nets excluded)
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const n of net.nets) {
    if (pnets.has(n.id)) continue;
    const ids = [...new Set(n.pins.map((p) => nodeOf(p.comp)))].filter((id) => nodes.has(id));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) link(ids[i], ids[j]);
  }
  // weaker links through power nets, used only for parts the signal graph cannot reach
  const padj = new Map<string, Set<string>>();
  for (const n of net.nets) {
    if (!pnets.has(n.id)) continue;
    const ids = [...new Set(n.pins.map((p) => nodeOf(p.comp)))].filter((id) => nodes.has(id));
    for (const a of ids) for (const b of ids) if (a !== b) (padj.get(a) ?? padj.set(a, new Set()).get(a)!).add(b);
  }

  const pi = comps.find((c) => c.type === 'rpi5');
  const root = pi ? nodeOf(pi.id) : null;
  if (root) {
    nodes.get(root)!.layer = 0;
    const q = [root];
    while (q.length) {
      const a = q.shift()!;
      for (const b of adj.get(a) ?? []) {
        const nb = nodes.get(b)!;
        if (nb.layer >= 0 || nb.role === 'power') continue;
        nb.layer = nodes.get(a)!.layer + 1;
        q.push(b);
      }
    }
  }
  // unreached parts: next to a reached neighbour (signal or power link), else after the last column
  let maxLayer = Math.max(0, ...[...nodes.values()].map((n) => n.layer));
  for (let pass = 0; pass < 3; pass++)
    for (const n of nodes.values()) {
      if (n.layer >= 0 || n.role === 'power' || n.role === 'model') continue;
      const nb = [...(adj.get(n.id) ?? []), ...(padj.get(n.id) ?? [])].map((id) => nodes.get(id)!).filter((x) => x.layer > 0 && x.role !== 'power');
      if (nb.length) n.layer = Math.max(...nb.map((x) => x.layer)) + (adj.get(n.id)?.size ? 1 : 0);
      else if (pass === 2) n.layer = Math.max(1, maxLayer);
    }
  // a passive part with a single signal neighbour (a series resistor at the end of a chain,
  // a pull-up) sits in the same column right next to that neighbour
  const attachedTo = new Map<string, string>();
  for (const n of nodes.values()) {
    if (n.role !== 'passive' || n.members.length > 1) continue;
    const nb = [...(adj.get(n.id) ?? [])];
    if (nb.length !== 1) continue;
    const o = nodes.get(nb[0])!;
    if (o.layer > 0 && o.role !== 'controller' && n.layer > o.layer) {
      n.layer = o.layer;
      attachedTo.set(n.id, o.id);
    }
  }
  maxLayer = Math.max(0, ...[...nodes.values()].map((n) => n.layer));
  // supplies go at the foot of the column they feed most (short supply wires to the loads)
  for (const n of nodes.values()) {
    if (n.role !== 'power') continue;
    const counts = new Map<number, number>();
    for (const id of [...(padj.get(n.id) ?? []), ...(adj.get(n.id) ?? [])]) {
      const o = nodes.get(id)!;
      if (o.layer > 0 && o.role !== 'power') counts.set(o.layer, (counts.get(o.layer) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (best) n.layer = best[0];
  }

  // ---- the Pi sits at the left with a wiring channel above its header
  const PI_X = 40;
  const PI_Y = piRotation ? 60 : 140;
  const pos = new Map<string, Pt>();
  const piNode = root ? nodes.get(root)! : null;
  if (piNode) pos.set(piNode.id, { x: PI_X, y: PI_Y });

  // barycentre key: where a node's connections sit in the columns to its left
  const anchorY = (id: string): number | null => {
    const n = nodes.get(id)!;
    const p = pos.get(id);
    return p ? p.y + n.h / 2 : null;
  };
  const piPinRank = (id: string) => {
    if (!pi) return 0;
    let best = Infinity;
    for (const w of doc.wires)
      for (const [a, b] of [
        [w.from, w.to],
        [w.to, w.from],
      ] as const)
        if (a.comp === pi.id && nodeOf(b.comp) === id) best = Math.min(best, Number(a.pin.slice(1)));
    return best === Infinity ? 99 : best;
  };

  // a channel is as wide as the number of distinct nets that have to pass through it
  const wireNodes = doc.wires.map((w) => ({ a: nodeOf(w.from.comp), b: nodeOf(w.to.comp), n: net.netOf(w.from) }));
  const gapAfter = (left: Set<string>) => {
    const nets = new Set<number>();
    for (const x of wireNodes) if (left.has(x.a) !== left.has(x.b)) nets.add(x.n);
    return Math.max(COL_GAP, Math.min(460, nets.size * 14 + 70));
  };
  const placedLeft = new Set<string>(piNode ? [piNode.id] : []);
  let colX = piNode ? PI_X + piNode.w + gapAfter(placedLeft) : 40;
  const columns: { role: Role; ids: string[] }[][] = [];
  for (let L = 1; L <= maxLayer; L++) {
    const items = [...nodes.values()].filter((n) => n.layer === L && n.role !== 'model');
    if (!items.length) continue;
    for (const n of items) {
      const ys = [...(adj.get(n.id) ?? [])].map(anchorY).filter((v): v is number => v !== null);
      n.key = L === 1 ? piPinRank(n.id) * 1000 : ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e6;
    }
    // attached passives sort right after their neighbour
    const sortRole = (n: Node) => ROLE_RANK[nodes.get(attachedTo.get(n.id) ?? n.id)!.role];
    const sortKey = (n: Node) => (attachedTo.has(n.id) ? nodes.get(attachedTo.get(n.id)!)!.key + 0.5 : n.key);
    const tie = (n: Node) => attachedTo.get(n.id) ?? n.id;
    items.sort((a, b) => sortRole(a) - sortRole(b) || sortKey(a) - sortKey(b) || tie(a).localeCompare(tie(b)) || Number(attachedTo.has(a.id)) - Number(attachedTo.has(b.id)));
    // stack, wrapping into extra sub-columns when the column gets too tall
    let y = 60;
    let colW = 0;
    let col: { role: Role; ids: string[] }[] = [];
    for (const n of items) {
      if (y > 60 && y + LABEL_SPACE + n.h > MAX_COL_H) {
        columns.push(col);
        col = [];
        colX += colW + gapAfter(placedLeft);
        y = 60;
        colW = 0;
      }
      pos.set(n.id, { x: colX, y: y + LABEL_SPACE });
      placedLeft.add(n.id);
      y += LABEL_SPACE + n.h + V_GAP;
      colW = Math.max(colW, n.w);
      const last = col[col.length - 1];
      if (last && last.role === n.role) last.ids.push(n.id);
      else col.push({ role: n.role, ids: [n.id] });
    }
    columns.push(col);
    colX += colW + gapAfter(placedLeft);
  }

  // ---- power zone under the Pi, farm-model parts after it
  let px = PI_X;
  const powerY = (piNode ? PI_Y + piNode.h : 60) + 110;
  const bottom: { role: Role; ids: string[] }[] = [];
  for (const role of ['power', 'model'] as const) {
    const items = [...nodes.values()].filter((n) => n.role === role && (role === 'model' || n.layer < 1));
    if (!items.length) continue;
    items.sort((a, b) => a.id.localeCompare(b.id));
    for (const n of items) {
      pos.set(n.id, { x: px, y: powerY + LABEL_SPACE });
      px += n.w + 70;
    }
    bottom.push({ role, ids: items.map((n) => n.id) });
    px += 40;
  }

  // ---- apply positions (snapped, so pins stay on the 10-unit grid)
  const moved = new Map<string, ComponentInstance>();
  for (const n of nodes.values()) {
    const p = pos.get(n.id) ?? { x: colX, y: 60 };
    for (const c of n.members) {
      const o = n.offsets.get(c.id)!;
      moved.set(c.id, { ...c, x: snap(p.x + o.x), y: snap(p.y + o.y) });
    }
  }
  let out: ProjectDoc = { ...doc, components: doc.components.map((c) => moved.get(c.id) ?? c) };

  // ---- zones for larger circuits
  const partCount = comps.filter((c) => c.type !== 'rpi5').length;
  if (opts.zones ?? partCount >= 7) {
    const zones: Zone[] = [];
    if (piNode) zones.push({ id: 'z-controller', label: ROLE_LABEL.controller, role: 'controller', members: piNode.members.map((c) => c.id) });
    const memberIds = (ids: string[]) => ids.flatMap((id) => nodes.get(id)!.members.map((c) => c.id));
    columns.forEach((col, ci) => col.forEach((g, gi) => zones.push({ id: `z-${ci}-${gi}`, label: ROLE_LABEL[g.role], role: g.role, members: memberIds(g.ids) })));
    for (const g of bottom) zones.push({ id: `z-${g.role}`, label: ROLE_LABEL[g.role], role: g.role, members: memberIds(g.ids) });
    out = { ...out, zones };
  } else out = { ...out, zones: undefined };

  if (opts.recolor) out = recolorWires(out);
  return routeWires(out);
}

// ------------------------------------------------------------------ colours by function
const SIGNAL_PALETTE = [W.yellow, W.green, W.blue, W.purple, W.orange, W.brown, W.white];

export function recolorWires(doc: ProjectDoc): ProjectDoc {
  const net = buildNetlist(doc);
  const pnets = powerNets(doc, net);
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const label = (comp: string, pin: string) => {
    const c = byId.get(comp);
    if (!c || !hasPart(c.type)) return pin;
    if (c.type === 'rpi5') return PI5_HEADER[Number(pin.slice(1)) - 1]?.name ?? pin;
    const m = getPart(c.type);
    return (pinsOf(m, withDefaults(m, c.props)).find((p) => p.id === pin)?.label ?? pin).toUpperCase();
  };
  const isGround = (n: number) =>
    n === net.groundNet ||
    net.nets[n]?.pins.some((p) => {
      const c = byId.get(p.comp);
      if (!c || !hasPart(c.type) || c.type === 'breadboard') return false;
      if (c.type === 'power_supply') return p.pin === 'N';
      const m = getPart(c.type);
      return pinsOf(m, withDefaults(m, c.props)).find((x) => x.id === p.pin)?.kind === 'ground';
    });
  let k = 0;
  const netColour = new Map<number, string>();
  const wires = doc.wires.map((w) => {
    const n = net.netOf(w.from);
    if (n < 0) return w;
    let color: string;
    if (pnets.has(n)) color = isGround(n) ? W.black : W.red;
    else {
      const names = [label(w.from.comp, w.from.pin), label(w.to.comp, w.to.pin)].join(' ');
      if (/SDA/.test(names)) color = W.blue;
      else if (/SCL/.test(names)) color = W.yellow;
      else if (/\bTX|TXD/.test(names) && /GPIO14|GPIO0\b|GPIO4\b|GPIO8\b|GPIO12\b/.test(names)) color = W.green;
      else if (/\bRX|RXD/.test(names) && /GPIO15|GPIO1\b|GPIO5\b|GPIO9\b|GPIO13\b/.test(names)) color = W.purple;
      else {
        // one colour per signal net so a net's wires look alike
        color = netColour.get(n) ?? SIGNAL_PALETTE[k++ % SIGNAL_PALETTE.length];
        if (color === W.white) color = SIGNAL_PALETTE[k++ % SIGNAL_PALETTE.length];
      }
    }
    netColour.set(n, color);
    return { ...w, color };
  });
  return { ...doc, wires };
}

// ------------------------------------------------------------------ routing
interface Grid {
  g: number;
  minX: number;
  minY: number;
  W: number;
  H: number;
  base: Float32Array;
  /** net id + 1 of the wire running horizontally / vertically through each cell (0 = free, -1 = several nets) */
  occH: Int32Array;
  occV: Int32Array;
}

function makeGrid(doc: ProjectDoc): Grid {
  const g = GRID;
  const bodies = doc.components.filter((c) => hasPart(c.type)).map(bodyOf);
  const x0 = Math.min(0, ...bodies.map((b) => b.x0)) - 200;
  const y0 = Math.min(0, ...bodies.map((b) => b.y0)) - 200;
  const x1 = Math.max(...bodies.map((b) => b.x1)) + 200;
  const y1 = Math.max(...bodies.map((b) => b.y1)) + 200;
  const minX = Math.floor(x0 / g);
  const minY = Math.floor(y0 / g);
  const W = Math.ceil(x1 / g) - minX + 1;
  const H = Math.ceil(y1 / g) - minY + 1;
  return { g, minX, minY, W, H, base: new Float32Array(W * H).fill(1), occH: new Int32Array(W * H), occV: new Int32Array(W * H) };
}

function markRect(G: Grid, r: Rect, cost: number, pad = 0) {
  const x0 = Math.max(G.minX, Math.floor((r.x0 - pad) / G.g));
  const x1 = Math.min(G.minX + G.W - 1, Math.ceil((r.x1 + pad) / G.g));
  const y0 = Math.max(G.minY, Math.floor((r.y0 - pad) / G.g));
  const y1 = Math.min(G.minY + G.H - 1, Math.ceil((r.y1 + pad) / G.g));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y - G.minY) * G.W + (x - G.minX);
      G.base[i] = Math.max(G.base[i], cost);
    }
}

const BODY = 400; // crossing a foreign part body
const OWN = 6; // leaving through the part the wire belongs to
const HALO = 6; // hugging another body
const LABEL = 4; // running over a part name
const OVERLAP = 60; // running along another wire
const CROSS = 14; // crossing another wire
const NEAR = 3; // running right next to another wire
const TURN = 5;
const SHARE = 0.5; // running along a wire of the same net

const occupy = (arr: Int32Array, i: number, net: number) => {
  arr[i] = arr[i] === 0 || arr[i] === net + 1 ? net + 1 : -1;
};

/** wires of the same net may share a track (they are one conductor); other nets keep apart */
function routeOne(G: Grid, a: Pt, b: Pt, own: Rect[], boards: Rect[], net: number): Pt[] | null {
  const { g, minX, minY, W, H } = G;
  const sx = Math.round(a.x / g);
  const sy = Math.round(a.y / g);
  const tx = Math.round(b.x / g);
  const ty = Math.round(b.y / g);
  if (sx < minX || sy < minY || tx < minX || ty < minY || sx >= minX + W || tx >= minX + W || sy >= minY + H || ty >= minY + H) return null;
  // the wire may leave its own part only near the pin; breadboards are cheap to cross towards a hole
  const relief = new Map<number, number>();
  const nearPins = own.length ? [a, b].map((p) => ({ x0: p.x - 30, y0: p.y - 40, x1: p.x + 30, y1: p.y + 40 })) : [];
  for (const r of [...nearPins, ...boards]) {
    const x0 = Math.max(minX, Math.floor(r.x0 / g));
    const x1 = Math.min(minX + W - 1, Math.ceil(r.x1 / g));
    const y0 = Math.max(minY, Math.floor(r.y0 / g));
    const y1 = Math.min(minY + H - 1, Math.ceil(r.y1 / g));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) relief.set((y - minY) * W + (x - minX), OWN);
  }
  const N = W * H * 4;
  const gs = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const heap: number[] = [];
  const fs: number[] = [];
  const push = (f: number, s: number) => {
    heap.push(s);
    fs.push(f);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[p] <= fs[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      [fs[p], fs[i]] = [fs[i], fs[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const lh = heap.pop()!;
    const lf = fs.pop()!;
    if (heap.length) {
      heap[0] = lh;
      fs[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && fs[l] < fs[m]) m = l;
        if (r < heap.length && fs[r] < fs[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [fs[m], fs[i]] = [fs[i], fs[m]];
        i = m;
      }
    }
    return top;
  };
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];
  const cell = (x: number, y: number) => (y - minY) * W + (x - minX);
  const hh = (x: number, y: number) => Math.abs(x - tx) + Math.abs(y - ty);
  for (let d = 0; d < 4; d++) {
    const s = cell(sx, sy) * 4 + d;
    gs[s] = 0;
    push(hh(sx, sy), s);
  }
  let goal = -1;
  let guard = 0;
  while (heap.length && guard++ < 600_000) {
    const s = pop();
    const c = s >> 2;
    const d = s & 3;
    const x = (c % W) + minX;
    const y = Math.floor(c / W) + minY;
    if (x === tx && y === ty) {
      goal = s;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if ((d ^ 1) === nd && gs[s] > 0) continue; // no U-turn
      const nx = x + DX[nd];
      const ny = y + DY[nd];
      if (nx < minX || ny < minY || nx >= minX + W || ny >= minY + H) continue;
      const nc = cell(nx, ny);
      let cost = relief.get(nc) ?? G.base[nc];
      const horiz = nd < 2;
      const along = horiz ? G.occH[nc] : G.occV[nc];
      const across = horiz ? G.occV[nc] : G.occH[nc];
      const mine = net + 1;
      // sharing a track never makes a part body cheap to cross
      if (along === mine) cost = cost > HALO ? cost : SHARE;
      else if (along !== 0) cost += OVERLAP;
      else if (across !== 0 && across !== mine) cost += CROSS;
      else {
        // spacing: next to another net's parallel run
        const o = horiz ? G.occH : G.occV;
        const n1 = horiz ? [ny > minY ? o[nc - W] : 0, ny < minY + H - 1 ? o[nc + W] : 0] : [nx > minX ? o[nc - 1] : 0, nx < minX + W - 1 ? o[nc + 1] : 0];
        if (n1.some((v) => v !== 0 && v !== mine)) cost += NEAR;
      }
      const ng = gs[s] + cost + (nd === d ? 0 : TURN);
      const ns = nc * 4 + nd;
      if (ng < gs[ns]) {
        gs[ns] = ng;
        from[ns] = s;
        push(ng + hh(nx, ny), ns);
      }
    }
  }
  if (goal < 0) return null;
  const cells: Pt[] = [];
  for (let s = goal; s >= 0; s = from[s]) {
    const c = s >> 2;
    cells.push({ x: ((c % W) + minX) * g, y: (Math.floor(c / W) + minY) * g });
  }
  cells.reverse();
  // occupancy for the next wires
  for (let i = 0; i + 1 < cells.length; i++) {
    const p = cells[i];
    const q = cells[i + 1];
    const arr = p.y === q.y ? G.occH : G.occV;
    for (const r of [p, q]) occupy(arr, cell(r.x / g, r.y / g), net);
  }
  return cells;
}

/**
 * Route wires orthogonally. `ids` limits routing to those wires (the others stay as
 * obstacles); by default every wire is routed.
 */
export function routeWires(doc: ProjectDoc, ids?: Set<string>): ProjectDoc {
  const comps = doc.components.filter((c) => hasPart(c.type));
  if (!comps.length || !doc.wires.length) return doc;
  const G = makeGrid(doc);
  const bodies = new Map(comps.map((c) => [c.id, bodyOf(c)]));
  const boards = comps.filter((c) => c.type === 'breadboard').map((c) => bodies.get(c.id)!);
  for (const c of comps) {
    if (c.type === 'breadboard') continue;
    const b = bodies.get(c.id)!;
    markRect(G, b, HALO, GRID);
    markRect(G, { x0: b.x0, y0: b.y0 - 26, x1: b.x1, y1: b.y0 - 4 }, LABEL);
  }
  for (const c of comps) if (c.type !== 'breadboard') markRect(G, bodies.get(c.id)!, BODY);
  // keep wires off the far left of the Pi: the parts are to its right
  const piC = comps.find((c) => c.type === 'rpi5');
  if (piC) {
    const b = bodies.get(piC.id)!;
    markRect(G, { x0: G.minX * GRID, y0: b.y0 + 60, x1: b.x0 - 10, y1: b.y1 + 60 }, 4);
  }
  const nl = buildNetlist(doc);
  const netOf = (w: Wire) => nl.netOf(w.from);
  // wires that are kept as they are still occupy their track
  const ends = (w: Wire) => [pinPoint(doc, w.from.comp, w.from.pin), pinPoint(doc, w.to.comp, w.to.pin)] as const;
  for (const w of doc.wires) {
    if (ids && ids.has(w.id)) continue;
    const [a, b] = ends(w);
    if (!a || !b) continue;
    const pts = [a, ...(w.points ?? []), b];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      if (p.x !== q.x && p.y !== q.y) continue;
      const arr = p.y === q.y ? G.occH : G.occV;
      const n = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) / GRID;
      for (let k = 0; k <= n; k++) {
        const x = Math.round((p.x + ((q.x - p.x) * k) / (n || 1)) / GRID) - G.minX;
        const y = Math.round((p.y + ((q.y - p.y) * k) / (n || 1)) / GRID) - G.minY;
        if (x >= 0 && y >= 0 && x < G.W && y < G.H) occupy(arr, y * G.W + x, netOf(w));
      }
    }
  }
  // short wires first: they have the fewest alternatives
  const todo = doc.wires
    .filter((w) => !ids || ids.has(w.id))
    .map((w) => ({ w, e: ends(w) }))
    .filter((x) => x.e[0] && x.e[1])
    .sort((p, q) => Math.abs(p.e[0]!.x - p.e[1]!.x) + Math.abs(p.e[0]!.y - p.e[1]!.y) - (Math.abs(q.e[0]!.x - q.e[1]!.x) + Math.abs(q.e[0]!.y - q.e[1]!.y)) || p.w.id.localeCompare(q.w.id));
  const routed = new Map<string, Wire>();
  for (const { w, e } of todo) {
    const [a, b] = e as [Pt, Pt];
    const own = [w.from.comp, w.to.comp].map((id) => bodies.get(id)).filter((r): r is Rect => !!r && !boards.includes(r));
    const cells = routeOne(G, a, b, own, boards, netOf(w));
    if (!cells) {
      routed.set(w.id, { ...w, points: [], route: 'orthogonal', auto: true });
      continue;
    }
    const pts = simplify([a, ...cells, b]);
    routed.set(w.id, { ...w, points: pts.slice(1, -1), route: 'orthogonal', auto: true });
  }
  return { ...doc, wires: doc.wires.map((w) => routed.get(w.id) ?? w) };
}

// ------------------------------------------------------------------ quality metrics (used by tests and the UI)
export interface LayoutQuality {
  overlaps: [string, string][];
  crossings: number;
  /** wire segments drawn across a part they do not belong to */
  overBodies: { wire: string; comp: string }[];
  dangling: string[];
  bends: number;
  bounds: Rect;
}

/** drawn polyline of a wire (same expansion as the workspace) */
export function wirePolyline(doc: ProjectDoc, w: Wire): Pt[] | null {
  const a = pinPoint(doc, w.from.comp, w.from.pin);
  const b = pinPoint(doc, w.to.comp, w.to.pin);
  if (!a || !b) return null;
  const ctl = [a, ...(w.points ?? []), b];
  if ((w.route ?? 'manual') !== 'orthogonal') return ctl;
  const pts: Pt[] = [a];
  for (let i = 1; i < ctl.length; i++) {
    const p = ctl[i - 1];
    const q = ctl[i];
    if (p.x !== q.x && p.y !== q.y) {
      const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
      const cameHorizontal = prev ? prev.y === p.y : Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
      pts.push(cameHorizontal && prev ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
    }
    pts.push(q);
  }
  return pts;
}

function segHitsRect(p: Pt, q: Pt, r: Rect, inset: number): boolean {
  const x0 = r.x0 + inset;
  const x1 = r.x1 - inset;
  const y0 = r.y0 + inset;
  const y1 = r.y1 - inset;
  if (x0 >= x1 || y0 >= y1) return false;
  if (p.y === q.y) return p.y > y0 && p.y < y1 && Math.max(p.x, q.x) > x0 && Math.min(p.x, q.x) < x1;
  if (p.x === q.x) return p.x > x0 && p.x < x1 && Math.max(p.y, q.y) > y0 && Math.min(p.y, q.y) < y1;
  // diagonal: sample
  for (let t = 0.05; t < 1; t += 0.05) {
    const x = p.x + (q.x - p.x) * t;
    const y = p.y + (q.y - p.y) * t;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

export function layoutQuality(doc: ProjectDoc): LayoutQuality {
  const comps = doc.components.filter((c) => hasPart(c.type));
  const net = buildNetlist(doc);
  const inserted = new Set(net.insertions.map((i) => i.comp));
  const bodies = comps.map((c) => ({ c, b: bodyOf(c) }));
  const overlaps: [string, string][] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i];
      const B = bodies[j];
      // a part plugged into a breadboard is meant to sit on it
      if ((A.c.type === 'breadboard' && inserted.has(B.c.id)) || (B.c.type === 'breadboard' && inserted.has(A.c.id))) continue;
      if (A.b.x0 < B.b.x1 && B.b.x0 < A.b.x1 && A.b.y0 < B.b.y1 && B.b.y0 < A.b.y1) overlaps.push([A.c.id, B.c.id]);
    }
  const paths: { id: string; pts: Pt[] }[] = [];
  const dangling: string[] = [];
  const overBodies: { wire: string; comp: string }[] = [];
  let bends = 0;
  for (const w of doc.wires) {
    const pts = wirePolyline(doc, w);
    if (!pts) {
      dangling.push(w.id);
      continue;
    }
    paths.push({ id: w.id, pts });
    bends += Math.max(0, pts.length - 2);
    for (const { c, b } of bodies) {
      if (c.id === w.from.comp || c.id === w.to.comp || c.type === 'breadboard') continue;
      for (let i = 0; i + 1 < pts.length; i++)
        if (segHitsRect(pts[i], pts[i + 1], b, 2)) {
          overBodies.push({ wire: w.id, comp: c.id });
          break;
        }
    }
  }
  // crossings between different nets (wires of one net crossing each other are the same conductor)
  const netOfWire = new Map(doc.wires.map((w) => [w.id, net.netOf(w.from)]));
  let crossings = 0;
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++)
      if (netOfWire.get(paths[i].id) !== netOfWire.get(paths[j].id))
      for (let s = 0; s + 1 < paths[i].pts.length; s++)
        for (let t = 0; t + 1 < paths[j].pts.length; t++) if (segIntersect(paths[i].pts[s], paths[i].pts[s + 1], paths[j].pts[t], paths[j].pts[t + 1])) crossings++;
  const all = bodies.map((x) => x.b);
  const bounds = all.length ? { x0: Math.min(...all.map((b) => b.x0)), y0: Math.min(...all.map((b) => b.y0)), x1: Math.max(...all.map((b) => b.x1)), y1: Math.max(...all.map((b) => b.y1)) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { overlaps, crossings, overBodies, dangling, bends, bounds };
}

/** Same nets before and after (as sets of pin keys) — Auto Arrange must not change connectivity. */
export function netSignature(doc: ProjectDoc): string[] {
  const net = buildNetlist(doc);
  return net.nets
    .map((n) => n.pins.map((p) => `${p.comp}:${p.pin}`).sort().join(','))
    .filter((s) => s.includes(','))
    .sort();
}
