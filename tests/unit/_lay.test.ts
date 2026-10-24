import { test } from 'vitest';
import { EXAMPLES } from '../../src/examples';
import { arrangeCircuit, layoutQuality, netSignature } from '../../src/engine/layout';
test('probe', () => {
  for (const ex of EXAMPLES) {
    const d = ex.build();
    const q0 = layoutQuality(d);
    const t0 = performance.now();
    const a = arrangeCircuit(d, { recolor: true });
    const ms = performance.now() - t0;
    const q1 = layoutQuality(a);
    const same = JSON.stringify(netSignature(d)) === JSON.stringify(netSignature(a));
    console.log(`${ex.n} ${ex.title.en.padEnd(34)} parts=${d.components.length} wires=${d.wires.length} | before ov=${q0.overlaps.length} x=${q0.crossings} body=${q0.overBodies.length} | after ov=${q1.overlaps.length} x=${q1.crossings} body=${q1.overBodies.length} bends=${q1.bends} nets=${same ? 'same' : 'CHANGED'} ${ms.toFixed(0)}ms`);
  }
});
