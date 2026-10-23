import type { ProjectDoc } from '../engine/types';
import type { Scenario } from '../tests/host';
import { CircuitBuilder } from '../engine/project';

export interface Bi {
  en: string;
  ar: string;
}

export interface Example {
  id: string;
  n: number;
  level: 'beginner' | 'intermediate' | 'advanced' | 'competition';
  title: Bi;
  objective: Bi;
  parts: string[];
  expected: Bi;
  instructions: Bi;
  breakIt: Bi[];
  build(): ProjectDoc;
  checks: Scenario[];
}

export const PI = { x: 20, y: 60 };

/** world position of a breadboard hole, for a breadboard placed at (bx, by) */
export function hole(bx: number, by: number, h: string) {
  const rows: Record<string, number> = { a: 50, b: 60, c: 70, d: 80, e: 90, f: 120, g: 130, h: 140, i: 150, j: 160 };
  let m = /^([a-j])(\d+)$/.exec(h);
  if (m) return { x: bx + 10 + Number(m[2]) * 10, y: by + rows[m[1]] };
  m = /^(tn|tp|bp|bn)(\d+)$/.exec(h);
  if (!m) throw new Error(`bad hole ${h}`);
  const y = { tn: 10, tp: 20, bp: 190, bn: 200 }[m[1] as 'tn'];
  return { x: bx + 10 + Number(m[2]) * 10, y: by + y };
}

/** place a part so that its pin (at local offset ox, oy) sits in the given hole */
export function onBoard(b: CircuitBuilder, bb: { x: number; y: number }, id: string, type: string, pinOffset: [number, number], h: string, props: Record<string, any> = {}) {
  const p = hole(bb.x, bb.y, h);
  b.add(id, type, p.x - pinOffset[0], p.y - pinOffset[1], props);
}

export function base(name: string) {
  return new CircuitBuilder().add('pi', 'rpi5', PI.x, PI.y, {}, 0, 'Raspberry Pi 5');
}

export function finish(b: CircuitBuilder, name: string, id: string, files: Record<string, string>, extra: Partial<ProjectDoc> = {}): ProjectDoc {
  const d = b.doc({ name });
  d.exampleId = id;
  d.files = Object.entries(files).map(([n, content]) => ({ name: n, content }));
  d.mainFile = 'main.py';
  return { ...d, ...extra };
}
