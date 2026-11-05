// The COMPETITION MASTER scenarios in the browser: the same definitions as the Node tests, run
// by the in-app test host against the real runtimes of the page (Pyodide worker, MicroPython
// worker, wb-rules in QuickJS). Nothing is replayed: the verdict reads the program output and the
// simulator while the program runs.
import { sim } from '../../state/engine';
import { useApp } from '../../state/store';
import type { Scenario, TestHost } from '../../tests/host';
import { masterScenarios, sampleMaster, startAt, type MasterCtl, type MasterScenario } from './scenarios';
import type { MasterProject } from './study';

export function inAppScenario(m: MasterProject, ms: MasterScenario, lang: 'en' | 'ar' = 'en'): Scenario {
  const L = (b: [string, string]) => (lang === 'ar' ? b[1] : b[0]);
  return {
    id: `${m.id}-${ms.id}`,
    name: L(ms.name),
    expected: L(ms.expected),
    async run(h: TestHost) {
      // in "check my project" mode the user's circuit and code are tested; any change a scenario
      // makes to the circuit (a removed wire, a sensor fault) is undone afterwards
      const snapshot = h.keepCurrent ? structuredClone(useApp.getState().doc) : null;
      try {
        await h.load(m.build());
        startAt(sim, ms.start ?? [8, 0, 0], false);
        const ctl: MasterCtl = { sim, board: m.board, mem: {}, editDoc: (fn) => h.editDoc(fn) };
        h.note(L(ms.does));
        await h.run();
        const events = [...ms.events].sort((a, b) => a.at - b.at);
        let last = 0;
        await h.waitSim(ms.seconds, (t) => {
          while (events.length && t >= events[0].at) events.shift()!.run(ctl);
          sampleMaster(sim, t, ctl.mem, Math.max(0, t - last));
          last = t;
        });
        const out = h.term();
        const verdict = ms.verify(out, ctl.mem, ctl);
        const err = h.pyError();
        const pass = verdict === null && !err;
        const status = /STATUS [^\n]*/.exec(out.slice(out.lastIndexOf('STATUS')))?.[0];
        return { pass, actual: pass ? (status ?? 'as expected') : `${verdict ?? ''} ${err?.message ?? ''}`.trim(), details: [out.slice(-1500)] };
      } finally {
        await h.stop();
        if (snapshot) useApp.getState().setDoc(snapshot, { markDirty: false });
      }
    },
  };
}

export function masterInAppScenarios(m: MasterProject, lang: 'en' | 'ar' = 'en', only?: string[]): Scenario[] {
  return masterScenarios(m.board)
    .filter((s) => !only || only.includes(s.id))
    .map((s) => inAppScenario(m, s, lang));
}
