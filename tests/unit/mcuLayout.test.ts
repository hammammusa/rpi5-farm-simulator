// Default layouts of the ESP32 / Wiren Board projects: Auto Arrange draws one section per
// controller and routes every wire around the part bodies. These checks compare each project
// with the measurements of the layout it had before (tests/unit/fixtures/mcu-layout-before.json:
// "opened" = how the project opened, "arranged" = the previous Auto Arrange; both re-measured
// with the true drawn size of the relay boards) and make sure only geometry changed.
import { describe, expect, it } from 'vitest';
import BEFORE from './fixtures/mcu-layout-before.json';
import { MCU_SPECS } from '../../src/library/controllers';
import { LIBRARY } from '../../src/library';
import { arrangeCircuit, bodyOf, layoutQuality, netSignature, routeWires, wirePolyline } from '../../src/engine/layout';
import type { ProjectDoc } from '../../src/engine/types';

type M = { crossings: number; overBodies: number; overlaps: number; bends: number; length: number };
const before = BEFORE as Record<string, { opened: M; arranged: M }>;
const opened = (id: string) => LIBRARY.find((e) => e.id === id)!.build();

const sameCircuit = (a: ProjectDoc, b: ProjectDoc) => {
  expect(netSignature(b)).toEqual(netSignature(a));
  expect(b.components.map((c) => [c.id, c.type, c.props, c.label])).toEqual(a.components.map((c) => [c.id, c.type, c.props, c.label]));
  expect(b.wires.map((w) => [w.id, w.from, w.to, w.color])).toEqual(a.wires.map((w) => [w.id, w.from, w.to, w.color]));
  expect(b.files).toEqual(a.files);
  expect(b.controllers).toEqual(a.controllers);
};

describe.each(MCU_SPECS.map((s) => [s.id, s] as const))('%s default layout', (id, spec) => {
  const raw = spec.build();
  const doc = opened(id);
  const q = layoutQuality(doc);

  it('opens arranged without changing the circuit, the programs or the wire colours', () => {
    sameCircuit(raw, doc);
    expect(doc.components.some((c, i) => c.x !== raw.components[i].x || c.y !== raw.components[i].y)).toBe(true);
    expect(doc.wires.every((w) => w.route === 'orthogonal')).toBe(true);
  });

  it('no overlapping parts, no dangling wires, no wire drawn across a part', () => {
    expect(q.overlaps).toEqual([]);
    expect(q.dangling).toEqual([]);
    expect(q.overBodies, JSON.stringify(q.overBodies)).toEqual([]);
  });

  it('fewer crossings than when it opened before, and a compact drawing', () => {
    expect(q.crossings).toBeLessThanOrEqual(before[id].opened.crossings);
    const w = q.bounds.x1 - q.bounds.x0;
    const h = q.bounds.y1 - q.bounds.y0;
    expect(w).toBeLessThan(1300);
    expect(h).toBeLessThan(800);
  });

  it('every wire is horizontal/vertical and enters its pins', () => {
    for (const wire of doc.wires) {
      const pts = wirePolyline(doc, wire)!;
      for (let i = 0; i + 1 < pts.length; i++) expect(pts[i].x === pts[i + 1].x || pts[i].y === pts[i + 1].y).toBe(true);
    }
  });

  it('Auto Arrange again gives the same drawing (stable)', () => {
    const again = arrangeCircuit(doc);
    expect(again.components.map((c) => [c.id, c.x, c.y, c.rotation])).toEqual(doc.components.map((c) => [c.id, c.x, c.y, c.rotation]));
    expect(again.wires.map((w) => w.points)).toEqual(doc.wires.map((w) => w.points));
  });

  it('moving one part and re-routing its wires leaves the rest of the drawing alone', () => {
    // move the last non-controller part by one grid step on each axis, as a drag would
    const part = doc.components.filter((c) => !['esp32_devkitc', 'wb74'].includes(c.type)).at(-1)!;
    const moved: ProjectDoc = { ...doc, components: doc.components.map((c) => (c.id === part.id ? { ...c, x: c.x + 20, y: c.y + 20 } : c)) };
    const ids = new Set(doc.wires.filter((w) => w.from.comp === part.id || w.to.comp === part.id).map((w) => w.id));
    const re = routeWires(moved, ids);
    sameCircuit(doc, re);
    for (const w of re.wires) if (!ids.has(w.id)) expect(w.points).toEqual(doc.wires.find((o) => o.id === w.id)!.points);
    const rq = layoutQuality(re);
    expect(rq.dangling).toEqual([]);
    expect(rq.overBodies.filter((o) => ids.has(o.wire))).toEqual([]);
    // the moved part still sits clear of every other part
    const b = bodyOf(re.components.find((c) => c.id === part.id)!);
    expect(re.components.filter((c) => c.id !== part.id).every((c) => {
      const o = bodyOf(c);
      return !(b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
    })).toBe(true);
  });
});

describe('ESP32 / Wiren Board layouts compared with before', () => {
  it('in total: fewer crossings, shorter wires and fewer bends than the previous Auto Arrange', () => {
    let x = 0, l = 0, b = 0, X = 0, L = 0, B = 0, ob = 0;
    const rows: string[] = [];
    for (const s of MCU_SPECS) {
      const q = layoutQuality(opened(s.id));
      x += q.crossings; l += q.length; b += q.bends; ob += q.overBodies.length;
      X += before[s.id].arranged.crossings; L += before[s.id].arranged.length; B += before[s.id].arranged.bends;
      rows.push(`${s.id}: crossings ${before[s.id].opened.crossings} / ${before[s.id].arranged.crossings} -> ${q.crossings}, over parts ${before[s.id].opened.overBodies} -> ${q.overBodies.length}, length ${before[s.id].arranged.length} -> ${q.length}, bends ${before[s.id].arranged.bends} -> ${q.bends}`);
    }
    console.log(rows.join('\n'));
    expect(ob).toBe(0);
    expect(x).toBeLessThan(X * 0.7);
    expect(l).toBeLessThan(L * 0.7);
    expect(b).toBeLessThan(B);
  });

  it('the integration project reads left to right: ESP32 + sensor, Wiren Board, WB-MR6C, pump', () => {
    const d = opened('mcu-esp32-wb7-integration');
    const x = (id: string) => d.components.find((c) => c.id === id)!.x;
    expect(x('soil')).toBeLessThan(x('esp'));
    expect(x('esp')).toBeLessThan(x('wb'));
    expect(x('wb')).toBeLessThan(x('mr'));
    expect(x('mr')).toBeLessThan(x('pump'));
    // the MQTT link is wireless: no wire joins the ESP32 section to the Wiren Board section
    const espSide = new Set(['esp', 'soil']);
    expect(d.wires.some((w) => espSide.has(w.from.comp) !== espSide.has(w.to.comp))).toBe(false);
  });
});
