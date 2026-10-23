// Electrical connectivity: union-find over wires, part-internal connections
// (breadboard strips, Pi GND/3V3/5V pins, button leg pairs) and breadboard
// insertions (a part pin sitting exactly on a breadboard hole).
// Connectivity never depends on visual proximity of bodies — only on explicit
// wires, documented internal connections, or a pin physically inserted in a hole.

import { pinWorld } from './geometry';
import { PI5_HEADER } from './pi5';
import { getPart, hasPart, pinsOf, withDefaults } from './parts';
import type { ComponentInstance, PinRef, ProjectDoc } from './types';

export interface Net {
  id: number;
  pins: PinRef[];
  name: string;
  /** non-breadboard components on this net */
  comps: Set<string>;
  piPins: number[]; // physical numbers
}

export interface Insertion {
  comp: string;
  pin: string;
  board: string;
  hole: string;
}

export interface Netlist {
  key(r: PinRef): string;
  netOf(r: PinRef): number;
  nets: Net[];
  insertions: Insertion[];
  piId: string | null;
  groundNet: number;
  /** bcm -> net id (for connected header pins) */
  gpioNet: Map<number, number>;
}

const k = (comp: string, pin: string) => `${comp}:${pin}`;

export function buildNetlist(doc: ProjectDoc): Netlist {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let x = a;
    while (parent.get(x)! !== r) {
      const n = parent.get(x)!;
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const comps = doc.components.filter((c) => hasPart(c.type));
  const holeAt = new Map<string, { board: string; hole: string }>();
  for (const c of comps) {
    const m = getPart(c.type);
    const props = withDefaults(m, c.props);
    for (const p of pinsOf(m, props)) {
      parent.set(k(c.id, p.id), k(c.id, p.id));
      if (c.type === 'breadboard') {
        const w = pinWorld(c, p, m.w, m.h);
        holeAt.set(`${Math.round(w.x)},${Math.round(w.y)}`, { board: c.id, hole: p.id });
      }
    }
  }
  for (const c of comps) {
    const m = getPart(c.type);
    const props = withDefaults(m, c.props);
    for (const g of m.internal?.(props) ?? []) for (let i = 1; i < g.length; i++) union(k(c.id, g[0]), k(c.id, g[i]));
  }
  // breadboard insertions
  const insertions: Insertion[] = [];
  for (const c of comps) {
    const m = getPart(c.type);
    if (!m.insertable) continue;
    const props = withDefaults(m, c.props);
    for (const p of pinsOf(m, props)) {
      const w = pinWorld(c, p, m.w, m.h);
      const h = holeAt.get(`${Math.round(w.x)},${Math.round(w.y)}`);
      if (h) {
        union(k(c.id, p.id), k(h.board, h.hole));
        insertions.push({ comp: c.id, pin: p.id, board: h.board, hole: h.hole });
      }
    }
  }
  for (const w of doc.wires) union(k(w.from.comp, w.from.pin), k(w.to.comp, w.to.pin));

  // assign net ids
  const rootId = new Map<string, number>();
  const nets: Net[] = [];
  const netIndex = new Map<string, number>();
  const typeOf = new Map(comps.map((c) => [c.id, c.type]));
  for (const key of parent.keys()) {
    const r = find(key);
    let id = rootId.get(r);
    if (id === undefined) {
      id = nets.length;
      rootId.set(r, id);
      nets.push({ id, pins: [], name: '', comps: new Set(), piPins: [] });
    }
    netIndex.set(key, id);
    const [comp, pin] = splitKey(key);
    nets[id].pins.push({ comp, pin });
    const t = typeOf.get(comp);
    if (t !== 'breadboard') nets[id].comps.add(comp);
    if (t === 'rpi5') nets[id].piPins.push(Number(pin.slice(1)));
  }

  const pi = comps.find((c) => c.type === 'rpi5') ?? null;
  const gpioNet = new Map<number, number>();
  let groundNet = -1;
  if (pi) {
    for (const h of PI5_HEADER) {
      const id = netIndex.get(k(pi.id, `P${h.physical}`));
      if (id === undefined) continue;
      if (h.kind === 'ground') groundNet = id;
      if (h.bcm !== null) gpioNet.set(h.bcm, id);
    }
  } else {
    const ps = comps.find((c) => c.type === 'power_supply');
    if (ps) groundNet = netIndex.get(k(ps.id, 'N')) ?? -1;
  }

  for (const n of nets) n.name = nameNet(n, pi);

  return {
    key: (r) => k(r.comp, r.pin),
    netOf: (r) => netIndex.get(k(r.comp, r.pin)) ?? -1,
    nets,
    insertions,
    piId: pi?.id ?? null,
    groundNet,
    gpioNet,
  };
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

function nameNet(n: Net, pi: ComponentInstance | null): string {
  if (pi && n.piPins.length) {
    const names = new Set(n.piPins.map((p) => PI5_HEADER[p - 1].name));
    return [...names].join('/');
  }
  return `Net ${n.id}`;
}
