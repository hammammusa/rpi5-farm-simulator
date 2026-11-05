// The three COMPETITION MASTER projects: every scenario runs the real program — Python in
// Pyodide (Raspberry Pi 5), MicroPython 1.29 (ESP32), wb-rules in QuickJS (Wiren Board 7.4) —
// against the simulated circuit and farm, and is judged on the program output and the circuit.
import { describe, expect, it } from 'vitest';
import { piMasterCircuit, espMasterCircuit, wbMasterCircuit } from '../../src/library/masters/circuits';
import { masterScenarios, runDueEvents, sampleMaster, startAt, type MasterBoard, type MasterCtl, type MasterScenario } from '../../src/library/masters/scenarios';
import type { ProjectDoc } from '../../src/engine/types';
import { Harness } from './pyharness';
import { McuHarness } from './mcuharness';
import { WbRulesEngine } from '../../src/runtime/wb/wbRules';
import { MASTER_PROJECTS, comparison, markerRange, recallPlaceholder, replaceMarked, sectionLines, splitComment, wiringNotes } from '../../src/library/masters/study';

const BUILD: Record<MasterBoard, () => ProjectDoc> = { pi: piMasterCircuit, esp: espMasterCircuit, wb: wbMasterCircuit };

const FILE: Record<MasterBoard, string> = { pi: 'main.py', esp: 'esp/main.py', wb: 'wb/rules.js' };

export async function runMasterScenario(board: MasterBoard, sc: MasterScenario, code?: string) {
  const doc = BUILD[board]();
  if (code !== undefined) doc.files = doc.files.map((f) => (f.name === FILE[board] ? { ...f, content: code } : f));
  const h = board === 'pi' ? new Harness(doc) : new McuHarness(doc);
  const sim = h.sim;
  const ctl: MasterCtl = { sim, board, mem: {}, editDoc: (fn) => sim.setDoc(fn(structuredClone(sim.doc))) };
  startAt(sim, sc.start ?? [8, 0, 0], true);
  const events = [...sc.events].sort((a, b) => a.at - b.at);
  let t0 = sim.clock.now();
  let last = 0;
  const step = () => {
    const t = sim.clock.now() - t0;
    runDueEvents(events, t, ctl);
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
    if (code === undefined) expect(r.status, `${r.error?.type}: ${r.error?.message}\n${r.stderr}`).toBe('stopped');
    out = r.stdout + r.stderr;
  } else if (board === 'esp') {
    const mh = h as McuHarness;
    mh.onWait = () => step();
    t0 = sim.clock.now();
    const r = await mh.runMicroPython('esp', sc.seconds);
    if (code === undefined) expect(r.status, `${r.error?.type}: ${r.error?.message}\n${r.stderr}`).toBe('stopped');
    out = r.stdout + r.stderr;
  } else {
    const mh = h as McuHarness;
    const lines: string[] = [];
    const e = new WbRulesEngine(sim, 'wb', { log: (lv, t) => lines.push(`${lv}: ${t}`) });
    sim.wb.get('wb')!.onLog = (l) => lines.push(`${l.level}: [${l.src}] ${l.msg}`);
    mh.advance(0.3);
    const r = await e.start(doc.files, 'wb/rules.js');
    if (code === undefined) expect(r.ok, JSON.stringify(r.error)).toBe(true);
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

describe('COMPETITION MASTER study material', () => {
  it.each(MASTER_PROJECTS.map((m) => [m.id, m] as const))('%s: 9 sections, recall parts, exercises, wiring notes', (_id, m) => {
    expect(m.sections).toHaveLength(9);
    for (const sec of m.sections) expect(sectionLines(m.code, sec).length, sec.id).toBeGreaterThan(2);
    expect(m.exercises.length).toBeGreaterThanOrEqual(5);
    expect(m.exercises.length).toBeLessThanOrEqual(10);
    for (const r of m.recall) expect(markerRange(m.code, r.marker, m.board), r.marker).not.toBeNull();
    // the program in the project is the study program
    const doc = m.build();
    expect(doc.files.find((f) => f.name === m.file)?.content).toBe(m.code);
    // every wire has a note with both ends and a reason
    const notes = wiringNotes(doc, m.board);
    expect(notes).toHaveLength(doc.wires.length);
    for (const n of notes) {
      expect(n.from).toContain('·');
      expect(n.why[1].length).toBeGreaterThan(5);
      expect(n.cut[1].length).toBeGreaterThan(5);
    }
    // every code line carries a comment (an Arabic note beside every line)
    const c = m.board === 'wb' ? '//' : '#';
    for (const line of m.code.split('\n')) {
      // a lone closing bracket needs no note
      if (!line.trim() || line.trim().startsWith(c) || /^[\s{}()[\];,]*$/.test(line)) continue;
      expect(splitComment(line, m.board).note, line).not.toBe('');
    }
  }, 60_000);

  it('the comparison table uses real lines of the three programs', () => {
    const rows = comparison();
    expect(rows).toHaveLength(10);
    for (const r of rows) for (const b of ['pi', 'esp', 'wb'] as MasterBoard[]) {
      const code = r.cells[b].code;
      if (code !== undefined) expect(code.length, `${r.key[0]} ${b}`).toBeGreaterThan(3);
    }
  });

  // code recall is judged by behaviour: with the part hidden (placeholder) its scenarios must fail,
  // with the original part they pass (above) — so a passing check means the rewritten code works
  for (const m of MASTER_PROJECTS)
    for (const r of m.recall)
      it(`${m.id}: hiding ${r.marker} makes its behaviour check fail`, async () => {
        const hidden = replaceMarked(m.code, r.marker, m.board, recallPlaceholder(m.code, r.marker, m.board));
        expect(hidden).not.toBe(m.code);
        const results = [];
        for (const id of r.scenarios) {
          const sc = masterScenarios(m.board).find((s) => s.id === id)!;
          results.push((await runMasterScenario(m.board, sc, hidden)).verdict);
        }
        expect(results.some((v) => v !== null), JSON.stringify(results)).toBe(true);
      }, 180_000);
});
