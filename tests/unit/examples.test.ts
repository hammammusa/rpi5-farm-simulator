import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/examples';
import { Harness } from './pyharness';

describe('learning examples run without Python errors', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.n}. ${ex.title.en}`, async () => {
      const doc = ex.build();
      const files: Record<string, string> = {};
      for (const f of doc.files) if (f.name !== 'main.py') files[f.name] = f.content;
      const h = new Harness(doc);
      const r = await h.run(doc.files.find((f) => f.name === 'main.py')!.content, { files, seconds: ex.n === 14 ? 400 : 8 });
      if (r.status === 'error' || /Traceback/.test(r.stderr)) console.log(ex.id, r.stdout.slice(-800), r.stderr.slice(-1500), JSON.stringify(r.error));
      expect(r.status === 'error' ? r.error?.traceback : 'no error').toBe('no error');
      expect(r.stderr).not.toMatch(/Traceback/);
      // circuits shipped with examples must be free of electrical errors
      const errors = h.sim.issues.filter((i) => i.severity === 'error').map((i) => i.code);
      expect(errors).toEqual([]);
    }, 120000);
  }

  it('example 20: web API, dosing and Nextion work together', async () => {
    const ex = EXAMPLES[19];
    const doc = ex.build();
    const files: Record<string, string> = {};
    for (const f of doc.files) if (f.name !== 'main.py') files[f.name] = f.content;
    const h = new Harness(doc);
    let step = 0;
    h.onWait = (hh) => {
      const t = hh.now() - hh.t0;
      if (step === 0 && hh.serving && t > 3) {
        step = 1;
        hh.sim.pushEvent({ k: 'http', id: 1, method: 'GET', path: '/api/state', query: '', body: '', headers: {} });
      } else if (step === 1 && hh.responses.has(1)) {
        step = 2;
        hh.sim.pushEvent({ k: 'http', id: 2, method: 'POST', path: '/api/dose', query: '', body: JSON.stringify({ A: 10, B: 5 }), headers: { 'Content-Type': 'application/json' } });
      } else if (step === 2 && t > 25) {
        step = 3;
        hh.sim.pushEvent({ k: 'http', id: 3, method: 'GET', path: '/', query: '', body: '', headers: {} });
      } else if (step === 3 && hh.responses.has(3)) hh.stop = true;
    };
    const r = await h.run(doc.files.find((f) => f.name === 'main.py')!.content, { files, seconds: 40 });
    if (r.status === 'error') console.log(r.stderr);
    expect(r.status).toBe('stopped');
    const state = JSON.parse(h.responses.get(1).body);
    expect(state.mode).toBe('AUTO');
    expect(state.values.ph).toBeGreaterThan(5);
    expect(state.values.co2).toBeGreaterThan(300);
    expect(state.values.water_temp).toBeGreaterThan(10);
    expect(h.responses.get(2).status).toBe(200);
    expect(Math.abs(h.sim.farm.state.totals.doseAml - 10)).toBeLessThan(1);
    expect(Math.abs(h.sim.farm.state.totals.doseBml - 5)).toBeLessThan(1);
    expect(h.sim.farm.state.alarms.map((a) => a.id)).not.toContain('AB_SIMULTANEOUS');
    expect(h.responses.get(3).body).toContain('City Farm');
    const nx = h.sim.device('nx') as any;
    expect(nx.liveOf(0, 'tTemp').attrs.txt).not.toBe('--');
  }, 120000);
});
