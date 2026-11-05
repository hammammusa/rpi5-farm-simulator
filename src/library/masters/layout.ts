// Baked default layouts of the three COMPETITION MASTER circuits. Routing these circuits takes
// seconds, so the result of placeMaster() (hand placement + routed wires) is stored in
// layouts.json and applied when a project is built; tests/unit/masterLayout.test.ts recomputes it
// and fails if the file is out of date (UPDATE_MASTER_LAYOUT=1 rewrites it). Only geometry is stored: parts, pins and wires come
// from the circuit builders, so a stored layout can never change a connection.
import type { ProjectDoc } from '../../engine/types';
import { placeMaster } from './placement';
import type { MasterBoard } from './scenarios';
import LAYOUTS from './layouts.json';

export interface StoredLayout {
  components: Record<string, [number, number, number]>;
  wires: Record<string, { points?: { x: number; y: number }[]; route?: string; auto?: boolean }>;
  zones?: ProjectDoc['zones'];
}

export function extractLayout(d: ProjectDoc): StoredLayout {
  return {
    components: Object.fromEntries(d.components.map((c) => [c.id, [c.x, c.y, c.rotation]])),
    wires: Object.fromEntries(d.wires.map((w) => [w.id, { points: w.points, route: w.route, auto: w.auto }])),
    zones: d.zones,
  };
}

export function applyLayout(d: ProjectDoc, l: StoredLayout): ProjectDoc | null {
  if (d.components.some((c) => !l.components[c.id]) || d.wires.some((w) => !l.wires[w.id])) return null;
  if (Object.keys(l.components).length !== d.components.length || Object.keys(l.wires).length !== d.wires.length) return null;
  return {
    ...d,
    components: d.components.map((c) => {
      const [x, y, rotation] = l.components[c.id];
      return { ...c, x, y, rotation: rotation as any };
    }),
    wires: d.wires.map((w) => {
      const s = l.wires[w.id];
      const out = { ...w, points: s.points, route: s.route as any, auto: s.auto };
      for (const k of ['points', 'route', 'auto'] as const) if (out[k] === undefined) delete out[k];
      return out;
    }),
    ...(l.zones ? { zones: l.zones } : {}),
  };
}

/** the circuit with its stored layout (or, if the circuit changed and the file was not updated, routed now) */
export function masterLayout(key: MasterBoard, raw: ProjectDoc): ProjectDoc {
  const l = (LAYOUTS as unknown as Record<string, StoredLayout>)[key];
  return (l && applyLayout(raw, l)) || placeMaster(raw, key);
}
