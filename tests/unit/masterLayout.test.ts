// The stored default layouts of the three COMPETITION MASTER circuits must be exactly what Auto
// Arrange produces for the current circuits, and must be clean: no overlapping parts, no wire
// through a part, nothing unconnected. UPDATE_MASTER_LAYOUT=1 rewrites layouts.json.
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { layoutQuality, netSignature } from '../../src/engine/layout';
import { placeMaster } from '../../src/library/masters/placement';
import { espMasterCircuit, piMasterCircuit, wbMasterCircuit } from '../../src/library/masters/circuits';
import { applyLayout, extractLayout } from '../../src/library/masters/layout';
import LAYOUTS from '../../src/library/masters/layouts.json';

const RAW = { pi: piMasterCircuit, esp: espMasterCircuit, wb: wbMasterCircuit };
const update = !!process.env.UPDATE_MASTER_LAYOUT;
const fresh: Record<string, unknown> = {};

describe('COMPETITION MASTER default layouts', () => {
  for (const [key, build] of Object.entries(RAW))
    it(`${key}: stored layout = placement + routing, and clean`, () => {
      const raw = build();
      const arranged = placeMaster(raw, key as any);
      const q0 = layoutQuality(arranged);
      console.log(key, JSON.stringify({ crossings: q0.crossings, bends: q0.bends, length: q0.length, overlaps: q0.overlaps, overBodies: q0.overBodies, bounds: q0.bounds }));
      const layout = extractLayout(arranged);
      fresh[key] = layout;
      if (update) writeFileSync('src/library/masters/layouts.json', JSON.stringify({ ...LAYOUTS, ...fresh }, null, 1) + '\n');
      else expect(JSON.parse(JSON.stringify(layout))).toEqual((LAYOUTS as any)[key]);
      const applied = applyLayout(raw, (update ? layout : (LAYOUTS as any)[key]) as any)!;
      expect(applied).not.toBeNull();
      expect(netSignature(applied)).toEqual(netSignature(raw));
      const q = layoutQuality(applied);
      expect(q.overlaps).toEqual([]);
      expect(q.overBodies).toEqual([]);
      expect(q.dangling).toEqual([]);
    }, 120_000);
});
