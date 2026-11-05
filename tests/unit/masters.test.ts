// The three COMPETITION MASTER projects: every scenario runs the real program — Python in
// Pyodide (Raspberry Pi 5), MicroPython 1.29 (ESP32), wb-rules in QuickJS (Wiren Board 7.4) —
// against the simulated circuit and farm, and is judged on the program output and the circuit.
import { describe, expect, it } from 'vitest';
import { piMasterCircuit, espMasterCircuit, wbMasterCircuit } from '../../src/library/masters/circuits';
import { masterScenarios, sampleMaster, startAt, type MasterBoard, type MasterCtl, type MasterScenario } from '../../src/library/masters/scenarios';
import type { ProjectDoc } from '../../src/engine/types';
import { Harness } from './pyharness';
import { McuHarness } from './mcuharness';
import { WbRulesEngine } from '../../src/runtime/wb/wbRules';

const BUILD: Record<MasterBoard, () => ProjectDoc> = { pi: piMasterCircuit, esp: espMasterCircuit, wb: wbMasterCircuit };

export async function runMasterScenario(board: MasterBoard, sc: MasterScenario) {
  const doc = BUILD[board]();
  const h = board === 'pi' ? new Harness(doc) : new McuHarness(doc);
  const sim = h.sim;
  const ctl: MasterCtl = { sim, board, mem: {}, editDoc: (fn) => sim.setDoc(fn(structuredClone(sim.doc))) };
  startAt(sim, sc.start ?? [8, 0, 0], true);
  const events = [...sc.events].sort((a, b) => a.at - b.at);
  let t0 = sim.clock.now();
  let last = 0;
  const step = () => {
    const t = sim.clock.now() - t0;
    while (events.length && t >= events[0].at) events.shift()!.run(ctl);
    sampleMaster(sim, t, ctl.mem, Math.max(0, t - last));
    last = t;
  };
  let out = '';
  if (board === 'pi') {
    const ph = h as Harness;
    ph.onWait = () => step();
    const files = Object.fromEntries(doc.files.filter((f) => f.name !== 'main.py').map((f) => [f.name, f.content]));
    t0 = sim.clock.now();
    const r = await ph.run(doc.files.find((f) => f.name === 'main.py')!.content, { files, seconds: sc.seconds });
    expect(r.status, `${r.error?.type}: ${r.error?.message}\n${r.stderr}`).toBe('stopped');
    out = r.stdout;
  } else if (board === 'esp') {
    const mh = h as McuHarness;
    mh.onWait = () => step();
    t0 = sim.clock.now();
    const r = await mh.runMicroPython('esp', sc.seconds);
    expect(r.status, `${r.error?.type}: ${r.error?.message}\n${r.stderr}`).toBe('stopped');
    out = r.stdout;
  } else {
    const mh = h as McuHarness;
    const lines: string[] = [];
    const e = new WbRulesEngine(sim, 'wb', { log: (lv, t) => lines.push(`${lv}: ${t}`) });
    sim.wb.get('wb')!.onLog = (l) => lines.push(`${l.level}: [${l.src}] ${l.msg}`);
    mh.advance(0.3);
    const r = await e.start(doc.files, 'wb/rules.js');
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    t0 = sim.clock.now();
    while (sim.clock.now() - t0 < sc.seconds) {
      mh.advance(0.05);
      e.poll();
      step();
    }
    e.stop();
    out = lines.join('\n');
  }
  return { out, verdict: sc.verify(out, ctl.mem, ctl), mem: ctl.mem };
}

for (const board of ['pi', 'esp', 'wb'] as MasterBoard[]) {
  describe(`COMPETITION MASTER — ${board}`, () => {
    const list = masterScenarios(board);
    it('has the 10 required scenarios', () => {
      expect(list.map((s) => s.id)).toEqual(['normal', 'high_temp', 'water_low', 'irrigation', 'dosing', 'test_mode', 'sensor_failure', 'lighting', 'wiring_error', 'full_system']);
    });
    it.each(list.map((s) => [s.id, s] as const))('%s', async (_id, sc) => {
      const { out, verdict } = await runMasterScenario(board, sc);
      expect(verdict, out.slice(-3000)).toBeNull();
    }, 180_000);
  });
}
