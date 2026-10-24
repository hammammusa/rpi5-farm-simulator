// Every component in the library: its documented example circuit + code runs in real
// Python (Pyodide) against the simulator, prints the expected output, passes its
// engine-level verification and raises no electrical errors.
import { describe, expect, it } from 'vitest';
import { PARTS } from '../../src/engine/parts';
import { PART_EXAMPLES, buildPartExample } from '../../src/catalog/examples';
import { Harness } from './pyharness';

const parts = PARTS.filter((m) => !m.hidden);

describe('component catalogue', () => {
  it('every part has a fidelity level, a library group and (unless visual-only) an example', () => {
    const missing = parts.filter((m) => m.fidelity !== 'visual' && !PART_EXAMPLES[m.type]).map((m) => m.type);
    expect(missing).toEqual([]);
    for (const m of parts) {
      expect(m.fidelity, m.type).toMatch(/^(full|functional|experimental|visual)$/);
      expect(m.group, m.type).toBeTruthy();
    }
  });

  it('the library holds at least 100 components', () => {
    expect(parts.length).toBeGreaterThanOrEqual(100);
  });
});

describe('component examples run in Python against the simulated circuit', () => {
  for (const m of parts) {
    const ex = PART_EXAMPLES[m.type];
    if (!ex || ex.noAutoTest) continue;
    it(`${m.type}: ${ex.title}`, async () => {
      const doc = buildPartExample(m.type);
      const h = new Harness(doc);
      const events = [...(ex.events ?? [])].sort((a, b) => a.at - b.at);
      h.onWait = (hh) => {
        while (events.length && hh.now() - hh.t0 >= events[0].at) {
          const e = events.shift()!;
          const id = e.comp ?? 'dut';
          if (e.press !== undefined) hh.sim.pressButton(id, e.press);
          if (e.props) {
            const d = hh.sim.doc;
            hh.sim.setDoc({ ...d, components: d.components.map((c) => (c.id === id ? { ...c, props: { ...c.props, ...e.props } } : c)) });
          }
        }
      };
      let verdict: string | null = null;
      const errorsSeen = new Set<string>();
      const prevWait = h.onWait;
      h.onWait = (hh) => {
        prevWait?.(hh);
        for (const i of hh.sim.issues) if (i.severity === 'error') errorsSeen.add(i.code);
      };
      const r = await h.run(ex.code, { seconds: ex.seconds ?? 6 });
      // verification uses the state reached at the end of the program
      if (ex.verify) {
        h.sim.programStart();
        verdict = null;
      }
      const out = r.stdout + r.stderr;
      expect(r.status, out).not.toBe('error');
      expect(out).toMatch(ex.expect);
      if (ex.verify) {
        // re-run once more to inspect the live state while the program's final outputs are still applied
        const h2 = new Harness(buildPartExample(m.type));
        let state: string | null = 'not checked';
        h2.onWait = () => {
          state = ex.verify!(h2.sim);
        };
        await h2.run(ex.code + '\nimport time\ntime.sleep(0.3)\n', { seconds: ex.seconds ?? 6 });
        verdict = state;
        expect(verdict, `${m.type} verification`).toBeNull();
      }
      expect([...errorsSeen], `${m.type}: electrical errors in the example circuit`).toEqual([]);
    }, 60000);
  }
});
