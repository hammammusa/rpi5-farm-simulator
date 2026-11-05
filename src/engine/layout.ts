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

/** programmable boards: each one is the root of its own section of the diagram */
export const CONTROLLER_TYPES = new Set(['rpi5', 'esp32_devkitc', 'wb74']);
const INTERFACE_TYPES = new Set(['wb_mr6c', 'relay_module', 'ssr', 'l298n', 'tb6612', 'npn', 'pnp', 'mosfet', 'pc817', 'hc08', 'hc32', 'hc86', 'hc04', 'level_shifter', 'max485', 'usb_serial']);
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
const ROLE_RANK: Record<Role, number> = { controller: 0, board: 1, input: 2, interface: 2, passive: 4, output: 5, display: 6, power: 7, model: 8 };

export function roleOf(type: string): Role {
  if (CONTROLLER_TYPES.has(type)) return 'controller';
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
/** area of the part's name (drawn above the body unless the part says otherwise) */
export function labelRect(c: ComponentInstance, b: Rect): Rect {
  const at = getPart(c.type).labelAt;
  if (!at || c.rotation) return { x0: b.x0, y0: b.y0 - 26, x1: b.x1, y1: b.y0 - 4 };
  const w = 60;
  const x0 = at.anchor === 'end' ? c.x + at.x - w : at.anchor === 'middle' ? c.x + at.x - w / 2 : c.x + at.x;
  return { x0, y0: c.y + at.y - 14, x1: x0 + w, y1: c.y + at.y + 4 };
}

export const bodyOf = (c: ComponentInstance): Rect => {
  const m = getPart(c.type);
  const s = m.size?.(withDefaults(m, c.props));
  return s ? boundsOf(c, s.w, s.h, m.w, m.h) : boundsOf(c, m.w, m.h);
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
  // circuits with an ESP32 or a Wiren Board: one section per controller (Pi-only circuits keep the column layout below)
  if (comps.some((c) => CONTROLLER_TYPES.has(c.type) && c.type !== 'rpi5')) return arrangeSections(doc, opts);
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
  // passives between the Pi and one part in the same column (a divider on an echo line, a
  // pull-up between a GPIO and a module) stay next to that part instead of in a passive group
  const isPart = (id: string) => {
    const r = nodes.get(id)!.role;
    return r !== 'controller' && r !== 'passive' && r !== 'power';
  };
  for (const n of nodes.values()) {
    if (n.role !== 'passive' || n.members.length > 1 || attachedTo.has(n.id)) continue;
    const partners = new Set<string>();
    for (const id of adj.get(n.id) ?? []) {
      if (isPart(id)) partners.add(id);
      else if (nodes.get(id)!.role === 'passive') for (const id2 of adj.get(id) ?? []) if (isPart(id2)) partners.add(id2);
    }
    if (partners.size !== 1) continue;
    const o = nodes.get([...partners][0])!;
    if (o.layer > 0 && o.layer === n.layer) attachedTo.set(n.id, o.id);
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
      // an attached passive belongs to its neighbour's group
      const role = attachedTo.has(n.id) ? nodes.get(attachedTo.get(n.id)!)!.role : n.role;
      const last = col[col.length - 1];
      if (last && last.role === role) last.ids.push(n.id);
      else col.push({ role, ids: [n.id] });
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
    net.groundNets.has(n) ||
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
const SHARE = 0.5; // running along a wire of the same net

/** router weights: what one crossing, one bend and a parallel neighbour cost, in grid cells */
export interface RouteCosts {
  cross: number;
  turn: number;
  near: number;
  /** rip-up and re-route rounds after the first routing */
  passes: number;
  /** re-route crossing pairs together, in both orders, keeping the best (rounds) */
  repair?: number;
  /** work budget of the pair repair: at most this many pairs are re-routed (deterministic, unlike a time limit) */
  budget?: number;
  /** routing order: short wires first (default), long first, or supply/ground wires last */
  order?: 'short' | 'long' | 'railsLast';
}
export const PI_ROUTE: RouteCosts = { cross: 14, turn: 5, near: 3, passes: 2, repair: 2, budget: 60 };

const occupy = (arr: Int32Array, i: number, net: number) => {
  arr[i] = arr[i] === 0 || arr[i] === net + 1 ? net + 1 : -1;
};

/** wires of the same net may share a track (they are one conductor); other nets keep apart */
function routeOne(G: Grid, a: Pt, b: Pt, own: Rect[], boards: Rect[], net: number, K: RouteCosts, margin = Infinity): Pt[] | null {
  if (margin !== Infinity) {
    const r = routeOneIn(G, a, b, own, boards, net, K, margin);
    if (r) return r;
  }
  return routeOneIn(G, a, b, own, boards, net, K, Infinity);
}

/** A* inside the box around both ends grown by `margin` (world units) */
function routeOneIn(G: Grid, a: Pt, b: Pt, own: Rect[], boards: Rect[], net: number, K: RouteCosts, margin: number): Pt[] | null {
  const CROSS = K.cross;
  const NEAR = K.near;
  const TURN = K.turn;
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
  const mg = margin === Infinity ? 1e9 : Math.ceil(margin / g);
  const bx0 = Math.min(sx, tx) - mg;
  const bx1 = Math.max(sx, tx) + mg;
  const by0 = Math.min(sy, ty) - mg;
  const by1 = Math.max(sy, ty) + mg;
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
      if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
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

/** mark the cells of an orthogonal track as used by `net` */
function occupyTrack(G: Grid, pts: Pt[], net: number) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p.x !== q.x && p.y !== q.y) continue;
    const arr = p.y === q.y ? G.occH : G.occV;
    const n = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) / GRID;
    for (let k = 0; k <= n; k++) {
      const x = Math.round((p.x + ((q.x - p.x) * k) / (n || 1)) / GRID) - G.minX;
      const y = Math.round((p.y + ((q.y - p.y) * k) / (n || 1)) / GRID) - G.minY;
      if (x >= 0 && y >= 0 && x < G.W && y < G.H) occupy(arr, y * G.W + x, net);
    }
  }
}

/** how badly a track meets other nets: 1 per crossing cell, 4 per cell run along another net */
function trackCrossings(G: Grid, pts: Pt[], net: number): number {
  const mine = net + 1;
  const other = (v: number) => v !== 0 && v !== mine;
  let n = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p.x !== q.x && p.y !== q.y) continue;
    const horiz = p.y === q.y;
    const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) / GRID;
    for (let k = 1; k < steps; k++) {
      const x = Math.round((p.x + ((q.x - p.x) * k) / steps) / GRID) - G.minX;
      const y = Math.round((p.y + ((q.y - p.y) * k) / steps) / GRID) - G.minY;
      if (x < 0 || y < 0 || x >= G.W || y >= G.H) continue;
      const c = y * G.W + x;
      if (other(horiz ? G.occV[c] : G.occH[c])) n++;
      if (other(horiz ? G.occH[c] : G.occV[c])) n += 4;
    }
  }
  return n;
}

/**
 * Route wires orthogonally. `ids` limits routing to those wires (the others stay as
 * obstacles); by default every wire is routed.
 */
export function routeWires(doc: ProjectDoc, ids?: Set<string>, K: RouteCosts = routeCostsFor(doc)): ProjectDoc {
  const comps = doc.components.filter((c) => hasPart(c.type));
  if (!comps.length || !doc.wires.length) return doc;
  const G = makeGrid(doc);
  const bodies = new Map(comps.map((c) => [c.id, bodyOf(c)]));
  const boards = comps.filter((c) => c.type === 'breadboard').map((c) => bodies.get(c.id)!);
  for (const c of comps) {
    if (c.type === 'breadboard') continue;
    const b = bodies.get(c.id)!;
    markRect(G, b, HALO, GRID);
    markRect(G, labelRect(c, b), LABEL);
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
  const railNets = K.order === 'railsLast' ? powerNets(doc, nl) : new Set<number>();
  // wires that are kept as they are still occupy their track
  const ends = (w: Wire) => [pinPoint(doc, w.from.comp, w.from.pin), pinPoint(doc, w.to.comp, w.to.pin)] as const;
  const trackOf = (w: Wire): Pt[] | null => {
    const [a, b] = ends(w);
    return a && b ? [a, ...(w.points ?? []), b] : null;
  };
  // wires that are not re-routed keep their track and are obstacles; in a full arrange every
  // wire is re-routed, so their old tracks must not count (or arranging twice would differ)
  for (const w of doc.wires) {
    if (!ids || ids.has(w.id)) continue;
    const pts = trackOf(w);
    if (pts) occupyTrack(G, pts, netOf(w));
  }
  // short wires first: they have the fewest alternatives
  const todo = doc.wires
    .filter((w) => !ids || ids.has(w.id))
    .map((w) => ({ w, e: ends(w) }))
    .filter((x) => x.e[0] && x.e[1])
    .sort((p, q) => {
      const len = (x: typeof p) => Math.abs(x.e[0]!.x - x.e[1]!.x) + Math.abs(x.e[0]!.y - x.e[1]!.y);
      if (K.order === 'railsLast') {
        const r = (x: typeof p) => (railNets.has(netOf(x.w)) ? 1 : 0);
        if (r(p) !== r(q)) return r(p) - r(q);
      }
      return (K.order === 'long' ? len(q) - len(p) : len(p) - len(q)) || p.w.id.localeCompare(q.w.id);
    });
  const routed = new Map<string, Wire>();
  const route = (w: Wire, a: Pt, b: Pt, margin = Infinity): Wire => {
    const own = [w.from.comp, w.to.comp].map((id) => bodies.get(id)).filter((r): r is Rect => !!r && !boards.includes(r));
    const cells = routeOne(G, a, b, own, boards, netOf(w), K, margin);
    return cells ? { ...w, points: simplify([a, ...cells, b]).slice(1, -1), route: 'orthogonal', auto: true } : { ...w, points: [], route: 'orthogonal', auto: true };
  };
  for (const { w, e } of todo) routed.set(w.id, route(w, e[0]!, e[1]!));
  // improvement pass for a full arrange: re-route each wire with all the others in place
  // and keep the new track when it crosses fewer wires
  if (!ids && todo.length >= 8) {
    const current = (w: Wire) => routed.get(w.id) ?? w;
    for (let pass = 0; pass < K.passes; pass++) {
      let changed = false;
      for (const { w, e } of todo) {
        G.occH.fill(0);
        G.occV.fill(0);
        for (const o of doc.wires) {
          if (o.id === w.id) continue;
          const pts = trackOf(current(o));
          if (pts) occupyTrack(G, pts, netOf(o));
        }
        const before = trackCrossings(G, trackOf(current(w))!, netOf(w));
        if (before === 0) continue;
        const next = route(w, e[0]!, e[1]!);
        if (next.points!.length && trackCrossings(G, trackOf(next)!, netOf(w)) < before) {
          routed.set(w.id, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  // pair repair: two wires that cross are ripped up together and re-routed in both orders
  if (!ids && K.repair) {
    const current = (w: Wire) => routed.get(w.id) ?? w;
    const byWire = new Map(todo.map((x) => [x.w.id, x]));
    const poly = (w: Wire) => wirePolyline(doc, current(w)) ?? [];
    const crossCount = (pa: Pt[], pb: Pt[]) => {
      let c = 0;
      for (let i = 0; i + 1 < pa.length; i++) for (let j = 0; j + 1 < pb.length; j++) if (segIntersect(pa[i], pa[i + 1], pb[j], pb[j + 1])) c++;
      return c;
    };
    const partsOf = (w: Wire) => [w.from.comp, w.to.comp].sort().join('|');
    const sameEnds = (a: Wire, b: Wire) => partsOf(a) === partsOf(b);
    const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) : 0), 0);
    /** crossings of wires `xs` with every other wire (and between themselves, once) */
    const score = (xs: Wire[], polys: Map<string, Pt[]>) => {
      const ids2 = new Set(xs.map((w) => w.id));
      let c = 0;
      let len = 0;
      for (const w of xs) {
        const pw = polys.get(w.id)!;
        len += lengthOf(pw);
        for (const o of doc.wires) {
          if (o.id === w.id || netOf(o) === netOf(w)) continue;
          if (ids2.has(o.id) && o.id < w.id) continue;
          c += crossCount(pw, polys.get(o.id) ?? poly(o));
        }
      }
      return c * 1000 + len / 10;
    };
    let work = K.budget ?? 100;
    for (let round = 0; round < K.repair && work > 0; round++) {
      const polys = new Map(doc.wires.map((w) => [w.id, poly(w)]));
      const pairs: [Wire, Wire][] = [];
      for (let i = 0; i < doc.wires.length; i++)
        for (let j = i + 1; j < doc.wires.length; j++) {
          const a = doc.wires[i];
          const b = doc.wires[j];
          if (netOf(a) === netOf(b) || !byWire.has(a.id) || !byWire.has(b.id)) continue;
          const c = crossCount(polys.get(a.id)!, polys.get(b.id)!);
          if (c) pairs.push([a, b, c + (sameEnds(a, b) ? 10 : 0)] as any);
        }
      if (!pairs.length) break;
      // most promising first: wires crossing more than once, pairs between the same two parts
      pairs.sort((p, q) => (q as any)[2] - (p as any)[2]);
      let improved = false;
      for (const [a, b] of pairs) {
        if (work-- <= 0) break;
        const pl = new Map(doc.wires.map((w) => [w.id, poly(w)]));
        if (!crossCount(pl.get(a.id)!, pl.get(b.id)!)) continue; // fixed by an earlier repair
        const before = score([a, b], pl);
        let best: { score: number; ra: Wire; rb: Wire } | null = null;
        for (const [first, second] of [
          [a, b],
          [b, a],
        ] as const) {
          G.occH.fill(0);
          G.occV.fill(0);
          for (const o of doc.wires) {
            if (o.id === a.id || o.id === b.id) continue;
            const pts = trackOf(current(o));
            if (pts) occupyTrack(G, pts, netOf(o));
          }
          const e1 = byWire.get(first.id)!.e;
          const r1 = route(first, e1[0]!, e1[1]!, 300);
          if (!r1.points!.length && Math.abs(e1[0]!.x - e1[1]!.x) + Math.abs(e1[0]!.y - e1[1]!.y) > 0 && e1[0]!.x !== e1[1]!.x && e1[0]!.y !== e1[1]!.y) continue;
          const e2 = byWire.get(second.id)!.e;
          const r2 = route(second, e2[0]!, e2[1]!, 300);
          const trial = new Map(pl);
          trial.set(r1.id, wirePolyline(doc, r1) ?? []);
          trial.set(r2.id, wirePolyline(doc, r2) ?? []);
          const sc = score([a, b], trial);
          const ra = first.id === a.id ? r1 : r2;
          const rb = first.id === a.id ? r2 : r1;
          if (!best || sc < best.score) best = { score: sc, ra, rb };
        }
        if (best && best.score < before - 0.5) {
          routed.set(a.id, best.ra);
          routed.set(b.id, best.rb);
          improved = true;
        }
      }
      if (!improved) break;
    }
  }
  return { ...doc, wires: doc.wires.map((w) => routed.get(w.id) ?? w) };
}

/** controller circuits (ESP32, Wiren Board) use their own weights; Pi-only circuits keep theirs */
export let MCU_ROUTE: RouteCosts = { cross: 14, turn: 5, near: 3, passes: 2, repair: 3, budget: 160 };
export function setMcuRoute(k: RouteCosts) {
  MCU_ROUTE = k;
}
export function routeCostsFor(doc: ProjectDoc): RouteCosts {
  return doc.components.some((c) => c.type === 'esp32_devkitc' || c.type === 'wb74') ? MCU_ROUTE : PI_ROUTE;
}

// ------------------------------------------------------------------ quality metrics (used by tests and the UI)
export interface LayoutQuality {
  overlaps: [string, string][];
  crossings: number;
  /** wire segments drawn across a part they do not belong to */
  overBodies: { wire: string; comp: string }[];
  dangling: string[];
  bends: number;
  /** total drawn wire length (world units) */
  length: number;
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
  const boardOf = new Map(net.insertions.map((i) => [i.comp, i.board]));
  const bodies = comps.map((c) => ({ c, b: bodyOf(c) }));
  const overlaps: [string, string][] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i];
      const B = bodies[j];
      // a part plugged into a breadboard is meant to sit on it
      if ((A.c.type === 'breadboard' && inserted.has(B.c.id)) || (B.c.type === 'breadboard' && inserted.has(A.c.id))) continue;
      // two parts plugged into the same breadboard sit where its holes put them (often in one strip)
      if (boardOf.has(A.c.id) && boardOf.get(A.c.id) === boardOf.get(B.c.id)) continue;
      if (A.b.x0 < B.b.x1 && B.b.x0 < A.b.x1 && A.b.y0 < B.b.y1 && B.b.y0 < A.b.y1) overlaps.push([A.c.id, B.c.id]);
    }
  const paths: { id: string; pts: Pt[] }[] = [];
  const dangling: string[] = [];
  const overBodies: { wire: string; comp: string }[] = [];
  let bends = 0;
  let length = 0;
  for (const w of doc.wires) {
    const pts = wirePolyline(doc, w);
    if (!pts) {
      dangling.push(w.id);
      continue;
    }
    paths.push({ id: w.id, pts });
    bends += Math.max(0, pts.length - 2);
    for (let i = 0; i + 1 < pts.length; i++) length += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
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
  return { overlaps, crossings, overBodies, dangling, bends, length: Math.round(length), bounds };
}

/** Same nets before and after (as sets of pin keys) — Auto Arrange must not change connectivity. */
export function netSignature(doc: ProjectDoc): string[] {
  const net = buildNetlist(doc);
  return net.nets
    .map((n) => n.pins.map((p) => `${p.comp}:${p.pin}`).sort().join(','))
    .filter((s) => s.includes(','))
    .sort();
}

// ================================================================== multi-controller layout
// Circuits with ESP32 boards or a Wiren Board are drawn as one section per controller, left
// to right (ESP32 sensor nodes, the Pi, then the Wiren Board hub). Inside a section the parts
// sit in columns by their distance from the controller, on the side of the controller where
// their pins are, each part aligned with the pins it connects to (so most wires run straight).
// Supplies go under the loads they feed. Only geometry changes; every wire keeps its pins.

const SECTION_ORDER: Record<string, number> = { esp32_devkitc: 0, rpi5: 1, wb74: 2 };
const SECTION_LABEL: Record<string, string> = { esp32_devkitc: 'ESP32 section', rpi5: 'Raspberry Pi section', wb74: 'Wiren Board 7 section' };
const TOP = 80;
const NODE_GAP = 34; // vertical space between two parts of a column (their labels sit above)
const SECTION_GAP = 150;

interface SNode {
  id: string;
  members: ComponentInstance[];
  role: Role;
  w: number;
  h: number;
  offsets: Map<string, Pt>;
  depth: number;
  owner: string | null;
  parent: string | null;
  side: 1 | -1;
}

function arrangeSections(doc: ProjectDoc, opts: ArrangeOptions): ProjectDoc {
  const comps = doc.components.filter((c) => hasPart(c.type));
  const net = buildNetlist(doc);
  const byId = new Map(comps.map((c) => [c.id, c]));

  // ---- nodes: a breadboard with what is plugged into it, or one part (free parts unrotated)
  const clusterOf = new Map<string, string>();
  for (const ins of net.insertions) clusterOf.set(ins.comp, ins.board);
  const nodeOf = (id: string) => clusterOf.get(id) ?? id;
  const nodes = new Map<string, SNode>();
  for (const c of comps) {
    const nid = nodeOf(c.id);
    if (!nodes.has(nid)) nodes.set(nid, { id: nid, members: [], role: 'passive', w: 0, h: 0, offsets: new Map(), depth: -1, owner: null, parent: null, side: 1 });
    nodes.get(nid)!.members.push(c);
  }
  for (const n of nodes.values()) {
    if (n.members.length === 1 && !clusterOf.has(n.members[0].id) && n.members[0].type !== 'breadboard') n.members = [{ ...n.members[0], rotation: 0 }];
    const bs = n.members.map(bodyOf);
    const x0 = Math.min(...bs.map((b) => b.x0));
    const y0 = Math.min(...bs.map((b) => b.y0));
    n.w = Math.max(...bs.map((b) => b.x1)) - x0;
    n.h = Math.max(...bs.map((b) => b.y1)) - y0;
    for (const c of n.members) n.offsets.set(c.id, { x: c.x - x0, y: c.y - y0 });
    n.role = n.members.some((c) => c.type === 'breadboard') ? 'board' : roleOf(n.members[0].type);
  }
  const member = (compId: string) => nodes.get(nodeOf(compId))!.members.find((c) => c.id === compId)!;

  // ---- nets: supply rails (supply terminals, controller power pins, or big all-power nets) vs links
  const kindOf = (comp: string, pin: string) => {
    const c = byId.get(comp);
    if (!c || c.type === 'breadboard') return null;
    const m = getPart(c.type);
    return pinsOf(m, withDefaults(m, c.props)).find((p) => p.id === pin)?.kind ?? null;
  };
  const rail = new Set<number>();
  for (const n of net.nets) {
    const owners = new Set(n.pins.map((p) => nodeOf(p.comp)));
    const kinds = n.pins.map((p) => kindOf(p.comp, p.pin)).filter((k) => !!k);
    const supply = n.pins.some((p) => byId.get(p.comp) && getPart(byId.get(p.comp)!.type).category === 'power');
    const ctrlPower = n.pins.some((p) => {
      const c = byId.get(p.comp);
      if (!c || !CONTROLLER_TYPES.has(c.type)) return false;
      if (c.type === 'rpi5') return PI5_HEADER[Number(p.pin.slice(1)) - 1]?.bcm === null;
      const k = kindOf(p.comp, p.pin);
      return k === 'power' || k === 'ground';
    });
    if (supply || ctrlPower || (kinds.length && kinds.every((k) => k === 'power' || k === 'ground') && owners.size >= 3)) rail.add(n.id);
  }
  const wires = doc.wires
    .map((w) => ({ w, a: nodeOf(w.from.comp), b: nodeOf(w.to.comp), net: net.netOf(w.from) }))
    .filter((x) => nodes.has(x.a) && nodes.has(x.b) && x.a !== x.b);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const n of net.nets) {
    if (rail.has(n.id)) continue;
    const ids = [...new Set(n.pins.map((p) => nodeOf(p.comp)))].filter((id) => nodes.has(id));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) link(ids[i], ids[j]);
  }

  // ---- sections: breadth-first from every controller at once
  const ctrls = [...nodes.values()]
    .filter((n) => n.role === 'controller')
    .sort((a, b) => (SECTION_ORDER[a.members[0].type] ?? 9) - (SECTION_ORDER[b.members[0].type] ?? 9) || a.id.localeCompare(b.id));
  const q: SNode[] = [];
  for (const c of ctrls) {
    c.depth = 0;
    c.owner = c.id;
    q.push(c);
  }
  while (q.length) {
    const a = q.shift()!;
    for (const id of [...(adj.get(a.id) ?? [])].sort()) {
      const b = nodes.get(id)!;
      if (b.depth >= 0 || b.role === 'power' || b.role === 'controller') continue;
      b.depth = a.depth + 1;
      b.owner = a.owner;
      b.parent = a.id;
      q.push(b);
    }
  }
  // parts reached only through supply wires join the section they share most wires with
  for (const n of nodes.values()) {
    if (n.depth >= 0 || n.role === 'power' || n.role === 'model') continue;
    const votes = new Map<string, number>();
    for (const x of wires) {
      const o = x.a === n.id ? x.b : x.b === n.id ? x.a : null;
      const on = o ? nodes.get(o)! : null;
      if (on && on.owner && on.role !== 'power') votes.set(on.id, (votes.get(on.id) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((p, r) => r[1] - p[1] || p[0].localeCompare(r[0]))[0];
    const host = best ? nodes.get(best[0])! : ctrls[0];
    n.owner = host?.owner ?? null;
    n.depth = host ? host.depth + 1 : 1;
    n.parent = host?.id ?? null;
  }

  // a passive part with a single neighbour (series resistor, pull-up) sits right under that
  // neighbour in its column instead of starting a column of its own
  const attached = new Map<string, string>();
  for (const n of nodes.values()) {
    if (n.role !== 'passive' || n.members.length > 1 || n.depth < 2) continue;
    const nb = [...(adj.get(n.id) ?? [])].map((id) => nodes.get(id)!).filter((o) => o.role !== 'power');
    if (nb.length !== 1 || nb[0].role === 'controller' || nb[0].owner !== n.owner) continue;
    n.depth = nb[0].depth;
    attached.set(n.id, nb[0].id);
  }

  // ---- pins in world coordinates for a node placed at `p`
  const pinLocal = (compId: string, pin: string): Pt | null => {
    const c = member(compId);
    const m = getPart(c.type);
    const pd = pinsOf(m, withDefaults(m, c.props)).find((x) => x.id === pin);
    if (!pd) return null;
    const o = nodes.get(nodeOf(compId))!.offsets.get(compId)!;
    const w = pinWorld({ ...c, x: 0, y: 0 }, pd, m.w, m.h);
    return { x: o.x + w.x, y: o.y + w.y };
  };
  const pos = new Map<string, Pt>();
  const pinAt = (compId: string, pin: string): Pt | null => {
    const p = pos.get(nodeOf(compId));
    const l = pinLocal(compId, pin);
    return p && l ? { x: p.x + l.x, y: p.y + l.y } : null;
  };
  // wire ends of node `id` towards placed nodes: [own pin (local), other pin (world)]
  const exitOf = (compId: string, pin: string): 'up' | 'down' | 'side' => {
    const n = nodes.get(nodeOf(compId))!;
    const l = pinLocal(compId, pin);
    if (!l) return 'side';
    if (l.y < 12 && l.y <= Math.min(l.x, n.w - l.x)) return 'up';
    if (n.h - l.y < 12 && n.h - l.y <= Math.min(l.x, n.w - l.x)) return 'down';
    return 'side';
  };
  const contacts = (id: string, signalOnly: boolean) => {
    const out: { own: Pt; other: Pt; exit: 'up' | 'down' | 'side'; otherW: number; otherH: number }[] = [];
    for (const x of wires) {
      if (signalOnly && rail.has(x.net)) continue;
      const mineFrom = x.a === id;
      if (!mineFrom && x.b !== id) continue;
      const ownEnd = mineFrom ? x.w.from : x.w.to;
      const otherEnd = mineFrom ? x.w.to : x.w.from;
      let other = pinAt(otherEnd.comp, otherEnd.pin);
      const own = pinLocal(ownEnd.comp, ownEnd.pin);
      // a pin on the far edge of the controller: the wire comes round its top or bottom, so the
      // part lines up with where the wire arrives, not with the pin itself
      const on = nodes.get(nodeOf(otherEnd.comp))!;
      const me = nodes.get(id)!;
      const op = pos.get(on.id);
      if (other && op && on.role === 'controller' && me.owner === on.id) {
        const local = { x: other.x - op.x, y: other.y - op.y };
        const edge = local.x < on.w / 2 ? -1 : 1;
        if (edge !== me.side) other = { x: other.x, y: local.y > on.h / 2 ? op.y + on.h + 30 : op.y - 30 };
      }
      if (other && own && nodeOf(otherEnd.comp) !== id) out.push({ own, other, exit: exitOf(otherEnd.comp, otherEnd.pin), otherW: on.w, otherH: on.h });
    }
    return out;
  };

  // ---- side of each first-ring part (ESP32 only; its headers are on both long edges). A wire
  // is cheap when it leaves the controller's edge facing the part AND enters the part's edge
  // facing the controller; the part's own loads hang off its far edge.
  const facing = (n: SNode, local: Pt): -1 | 0 | 1 => {
    const d = Math.min(local.x, n.w - local.x, local.y, n.h - local.y);
    if (local.x <= d + 0.5) return -1; // left edge
    if (n.w - local.x <= d + 0.5) return 1; // right edge
    return 0; // top / bottom: either way
  };
  for (const n of nodes.values()) {
    if (n.depth !== 1 || !n.owner) continue;
    const ctrl = nodes.get(n.owner)!;
    if (ctrl.members[0].type !== 'esp32_devkitc') continue;
    const cost = { [-1]: 0, [1]: 0 } as Record<-1 | 1, number>;
    for (const x of wires) {
      const toCtrl = (x.a === n.id && x.b === ctrl.id) || (x.b === n.id && x.a === ctrl.id);
      const ownEnd = x.a === n.id ? x.w.from : x.b === n.id ? x.w.to : null;
      if (!ownEnd) continue;
      const own = pinLocal(ownEnd.comp, ownEnd.pin);
      if (!own) continue;
      const f = facing(n, own);
      const wgt = rail.has(x.net) ? 1 : 3;
      for (const side of [-1, 1] as const) {
        if (toCtrl) {
          const cEnd = x.a === ctrl.id ? x.w.from : x.w.to;
          const cl = pinLocal(cEnd.comp, cEnd.pin);
          if (cl && (cl.x < ctrl.w / 2 ? -1 : 1) !== side) cost[side] += wgt; // controller pin on the far edge
          if (f !== 0 && f !== -side) cost[side] += wgt; // part pin facing away from the controller
        } else {
          const other = nodes.get(x.a === n.id ? x.b : x.a);
          if (other && other.parent === n.id && f !== 0 && f !== side) cost[side] += wgt; // its load sits outward
        }
      }
    }
    if (cost[-1] < cost[1]) n.side = -1;
  }
  for (const n of [...nodes.values()].sort((a, b) => a.depth - b.depth)) {
    const host = attached.get(n.id) ?? (n.depth > 1 ? n.parent : null);
    if (host) n.side = nodes.get(host)!.side;
  }

  /** which edge of the node most of these own pins sit on */
  const pinEdge = (n: SNode, pts: Pt[]): 'top' | 'bottom' | 'side' => {
    let top = 0;
    let bottom = 0;
    for (const p of pts) {
      const d = Math.min(p.x, n.w - p.x, p.y, n.h - p.y);
      if (n.h - p.y <= d + 0.5 && n.h - p.y < 12) bottom++;
      else if (p.y <= d + 0.5 && p.y < 12) top++;
    }
    return bottom > pts.length / 2 ? 'bottom' : top > pts.length / 2 ? 'top' : 'side';
  };

  // ---- place the sections
  const placedSections: { ctrl: SNode; ids: string[] }[] = [];
  let x = 40;
  const sectionNodes = (c: SNode) => [...nodes.values()].filter((n) => n.owner === c.id && n.role !== 'power' && n.role !== 'model');
  const colIndex = (n: SNode) => n.side * n.depth;
  for (const ctrl of ctrls) {
    const mine = sectionNodes(ctrl);
    const lab = getPart(ctrl.members[0].type).labelAt;
    if (lab && lab.x < 0) x += 60; // room for a name drawn left of the board
    const cols = [...new Set(mine.map(colIndex))].sort((a, b) => a - b);
    const colOf = new Map(cols.map((k) => [k, mine.filter((n) => colIndex(n) === k)]));
    const width = new Map(cols.map((k) => [k, Math.max(...colOf.get(k)!.map((n) => n.w))]));
    // channel between two columns: room for every net that passes it
    const gapAfter = (k: number) => {
      const leftSide = new Set(mine.filter((n) => colIndex(n) <= k).map((n) => n.id));
      const nets = new Set<number>();
      for (const w of wires) if (leftSide.has(w.a) !== leftSide.has(w.b) && (mine.some((n) => n.id === w.a) || mine.some((n) => n.id === w.b))) nets.add(w.net);
      return Math.max(110, Math.min(380, nets.size * 16 + 60));
    };
    const colX = new Map<number, number>();
    for (const k of cols) {
      colX.set(k, x);
      x += width.get(k)! + (k === cols[cols.length - 1] ? 0 : gapAfter(k));
    }
    // controller first, then the columns outward on each side
    pos.set(ctrl.id, { x: colX.get(0)!, y: TOP });
    const order = [...cols.filter((k) => k > 0), ...cols.filter((k) => k < 0).reverse()];
    for (const k of order) {
      const items = colOf.get(k)!.map((n) => {
        // align the part's own pins with the pins they connect to
        let cs = contacts(n.id, true);
        if (!cs.length) cs = contacts(n.id, false);
        // pins on the bottom edge line up with the highest pin they reach (the wires then run
        // across and down the channel); on the top edge with the lowest; on a side, the average
        const edge = cs.length ? pinEdge(n, cs.map((c) => c.own)) : 'side';
        const all = contacts(n.id, false);
        // a wire leaving a top-edge terminal goes up first, a bottom-edge one down: the part lines
        // up with the level where the wire arrives, so it is entered from the right direction
        const eff = (c: (typeof cs)[number]) => (c.exit === 'up' ? c.other.y - 30 : c.exit === 'down' ? c.other.y + 30 : c.other.y);
        const vertical = cs.some((c) => c.exit !== 'side');
        const target = !cs.length
          ? TOP
          : edge === 'bottom'
            ? vertical
              ? Math.min(...cs.map(eff)) - 10 - Math.max(...cs.map((c) => c.own.y))
              : Math.min(...all.map((c) => c.other.y)) - Math.max(...all.map((c) => c.own.y)) + 20
            : edge === 'top'
              ? vertical
                ? Math.max(...cs.map(eff)) + 10 - Math.min(...cs.map((c) => c.own.y))
                : Math.max(...all.map((c) => c.other.y)) - Math.min(...all.map((c) => c.own.y)) - 20
              : cs.reduce((s, c) => s + eff(c) - c.own.y, 0) / cs.length;
        const key = cs.length ? cs.reduce((s, c) => s + c.other.y, 0) / cs.length : 1e6;
        return { n, target, key };
      });
      // an attached passive follows its host; the others by where their wires come from
      const keyOf = (it: (typeof items)[number]) => {
        const h = attached.get(it.n.id);
        const hi = h ? items.find((o) => o.n.id === h) : null;
        return hi ? hi.key + 0.001 : it.key;
      };
      items.sort((a, b) => keyOf(a) - keyOf(b) || a.n.id.localeCompare(b.n.id));
      // stack in that order as close to each target as the parts above allow
      // parts may sit above the controller's top (the drawing is moved back into view at the end)
      let floor = TOP - 600;
      const ys: number[] = [];
      for (const it of items) {
        const y = Math.max(floor, snap(it.target));
        ys.push(y);
        floor = y + it.n.h + NODE_GAP + LABEL_SPACE;
      }
      items.forEach((it, i) => {
        const cx = colX.get(k)!;
        // narrow parts are centred in a wide column on the controller side, so their pins face it
        const dx = k > 0 ? 0 : width.get(k)! - it.n.w;
        pos.set(it.n.id, { x: cx + dx, y: ys[i] });
      });
    }
    placedSections.push({ ctrl, ids: [ctrl.id, ...mine.filter((n) => n !== ctrl).map((n) => n.id)] });
    x += SECTION_GAP + (ctrls.indexOf(ctrl) < ctrls.length - 1 ? gapAfter(cols[cols.length - 1]) - 110 : 0);
  }

  // ---- supplies: under the loads they feed (median of their wire ends), below what is already there
  const rectOf = (id: string) => {
    const p = pos.get(id)!;
    const n = nodes.get(id)!;
    return { x0: p.x, y0: p.y - LABEL_SPACE, x1: p.x + n.w, y1: p.y + n.h };
  };
  const hit = (a: Rect, b: Rect, m = 20) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
  const supplies = [...nodes.values()].filter((n) => n.role === 'power' || (!pos.has(n.id) && n.role !== 'model')).sort((a, b) => a.id.localeCompare(b.id));
  for (const s of supplies) {
    const cs = contacts(s.id, false);
    const span = (x0: number) => ({ x0, x1: x0 + s.w });
    // a supply sits under a column of parts (never in a channel between columns, where it would
    // block the wires), below everything in that column
    const below = (x0: number): number | null => {
      const sp = span(x0);
      let y: number | null = null;
      for (const id of pos.keys()) {
        const r = rectOf(id);
        if (r.x0 < sp.x1 + 30 && sp.x0 < r.x1 + 30) y = Math.max(y ?? TOP, r.y1 + NODE_GAP + LABEL_SPACE + 30);
      }
      // the column must really be under parts (overlap, not just a neighbour within 30)
      const under = [...pos.keys()].some((id) => {
        const r = rectOf(id);
        const cx = (sp.x0 + sp.x1) / 2;
        return nodes.get(id)!.role !== 'power' && cx > r.x0 + 10 && cx < r.x1 - 10;
      });
      return under ? y : null;
    };
    // candidate spots along the bottom: shortest estimated wiring, counting the detour of a wire
    // that has to go round the supply's body because its terminal faces away from the target
    const placedRects = [...pos.keys()].map(rectOf);
    const minX = Math.min(40, ...placedRects.map((r) => r.x0));
    const maxX = Math.max(...placedRects.map((r) => r.x1), 40);
    let best: { x: number; y: number; cost: number } | null = null;
    const above = (x0: number): number | null => {
      const sp = span(x0);
      let y: number | null = null;
      for (const id of pos.keys()) {
        const r = rectOf(id);
        if (r.x0 < sp.x1 + 30 && sp.x0 < r.x1 + 30) y = Math.min(y ?? 1e9, r.y0 - NODE_GAP - 30 - s.h);
      }
      const under = [...pos.keys()].some((id) => {
        const r = rectOf(id);
        const cx = (sp.x0 + sp.x1) / 2;
        return nodes.get(id)!.role !== 'power' && cx > r.x0 + 10 && cx < r.x1 - 10;
      });
      return under ? y : null;
    };
    for (const [px, py, up] of [...Array(Math.max(0, Math.ceil((maxX - minX + s.w) / 20)))].flatMap((_, i) => {
      const px = snap(minX - s.w / 2) + i * 20;
      return [
        [px, below(px), false],
        [px, above(px), true],
      ] as [number, number | null, boolean][];
    })) {
      if (py === null) continue;
      const r = { x0: px, y0: py - LABEL_SPACE, x1: px + s.w, y1: py + s.h };
      if (placedRects.some((o) => hit(r, o))) continue;
      let cost = 0;
      for (const c of cs) {
        const p = { x: px + c.own.x, y: py + c.own.y };
        cost += Math.abs(p.x - c.other.x) + Math.abs(p.y - c.other.y);
        // terminal facing away from its target: the wire steps out and back; when the target is
        // level with the body it also has to go round it
        // the target terminal leaves its part downwards (or upwards) but the supply is on the
        // other side: the wire has to go round that part
        if (c.exit !== 'side' && (c.exit === 'down' ? p.y < c.other.y : p.y > c.other.y)) cost += 2 * c.otherH + c.otherW;
        const facesRight = c.own.x > s.w / 2;
        if ((facesRight && c.other.x < p.x - 10) || (!facesRight && c.other.x > p.x + 10)) {
          cost += 20;
          if (c.other.y > py - 10 && c.other.y < py + s.h + 10) cost += 2 * Math.min(c.own.y, s.h - c.own.y) + 40;
        }
      }
      // never park a supply where the wires of other parts leave downwards
      for (const id of pos.keys()) {
        const n = nodes.get(id)!;
        if (n.role === 'power') continue;
        const pp = pos.get(id)!;
        for (const x of wires) {
          const end = x.a === id ? x.w.from : x.b === id ? x.w.to : null;
          if (!end || x.a === s.id || x.b === s.id) continue;
          const l = pinLocal(end.comp, end.pin);
          if (!l || (up ? l.y > 12 : n.h - l.y > 12)) continue; // only pins on the edge facing the supply
          const wx = pp.x + l.x;
          if (wx > px - 20 && wx < px + s.w + 20) cost += 150;
        }
      }
      cost += (py - TOP) * 0.3; // prefer staying close to the circuit
      if (!best || cost < best.cost) best = { x: px, y: py, cost };
    }
    const at = best ?? { x: snap(maxX + 60), y: TOP };
    pos.set(s.id, { x: at.x, y: snap(at.y) });
  }
  // parts without pins (farm model): a row at the bottom right
  let mx = Math.max(40, ...[...pos.keys()].map((id) => rectOf(id).x1)) + 60;
  for (const n of nodes.values()) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, { x: snap(mx), y: TOP });
    mx += n.w + 60;
  }

  // ---- the drawing starts at the top of the view again
  const minY = Math.min(...[...pos.keys()].map((id) => rectOf(id).y0));
  const minX0 = Math.min(...[...pos.keys()].map((id) => rectOf(id).x0));
  const dy = snap(TOP - LABEL_SPACE - minY);
  const dx = minX0 < 40 ? snap(40 - minX0) : 0;
  for (const [id, p] of pos) pos.set(id, { x: p.x + dx, y: p.y + dy });

  // ---- apply (snapped: pins stay on the 10-unit grid)
  const moved = new Map<string, ComponentInstance>();
  for (const n of nodes.values()) {
    const p = pos.get(n.id)!;
    for (const c of n.members) {
      const o = n.offsets.get(c.id)!;
      moved.set(c.id, { ...c, x: snap(p.x + o.x), y: snap(p.y + o.y) });
    }
  }
  let out: ProjectDoc = { ...doc, components: doc.components.map((c) => moved.get(c.id) ?? c) };
  const partCount = comps.filter((c) => !CONTROLLER_TYPES.has(c.type)).length;
  if (opts.zones ?? partCount >= 7) {
    const zones: Zone[] = placedSections.map((s) => ({
      id: `z-${s.ctrl.id}`,
      label: SECTION_LABEL[s.ctrl.members[0].type] ?? 'Controller section',
      role: 'controller',
      members: s.ids.flatMap((id) => nodes.get(id)!.members.map((c) => c.id)),
    }));
    const pw = supplies.filter((n) => n.role === 'power');
    if (pw.length) zones.push({ id: 'z-power', label: ROLE_LABEL.power, role: 'power', members: pw.flatMap((n) => n.members.map((c) => c.id)) });
    out = { ...out, zones };
  } else out = { ...out, zones: undefined };
  if (opts.recolor) out = recolorWires(out);
  return routeWires(out);
}
