// In-app test driver: runs real Python in the real worker against the real
// simulator. Used by the acceptance-test page, example "Check" buttons and the
// competition mode. Nothing here fakes results — every check reads the
// simulator state or program output produced by the run.
import { getRuntime, runProgram, sim, startRuntime, stopProgram } from '../state/engine';
import { useApp } from '../state/store';
import type { ProjectDoc } from '../engine/types';

export interface TestResult {
  pass: boolean;
  actual: string;
  details?: string[];
}

export class TestHost {
  steps: string[] = [];
  constructor(public speed = 1) {}

  note(s: string) {
    this.steps.push(s);
  }

  async load(doc: ProjectDoc) {
    const d = structuredClone(doc);
    d.sim = { ...d.sim, speed: this.speed };
    useApp.getState().loadProject(d);
    sim.setDoc(d);
    sim.resetSimulation();
    sim.clock.setSpeed(this.speed);
    useApp.getState().setSpeed(this.speed);
    await this.realWait(30);
  }

  async ready() {
    const rt = startRuntime();
    if (!rt) throw new Error('Python runtime unavailable (page not cross-origin isolated)');
    await rt.whenReady();
    return rt;
  }

  async run(code?: string, files?: Record<string, string>) {
    const rt = await this.ready();
    if (code !== undefined || files) {
      const st = useApp.getState();
      let fs = st.doc.files.slice();
      if (code !== undefined) fs = fs.map((f) => (f.name === st.doc.mainFile ? { ...f, content: code } : f));
      for (const [n, c] of Object.entries(files ?? {})) {
        const i = fs.findIndex((f) => f.name === n);
        if (i >= 0) fs[i] = { name: n, content: c };
        else fs.push({ name: n, content: c });
      }
      st.setDoc({ ...st.doc, files: fs }, { markDirty: false });
    }
    await runProgram();
    // wait until the worker actually started executing user code
    await this.realWait(50);
    return rt;
  }

  async stop() {
    await stopProgram();
  }

  realWait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** wait `seconds` of simulation time, calling `sample` every ~20 ms real time */
  async waitSim(seconds: number, sample?: (t: number) => void) {
    const end = sim.clock.now() + seconds;
    const t0 = sim.clock.now();
    for (;;) {
      const now = sim.clock.now();
      sample?.(now - t0);
      if (now >= end) return;
      const rt = getRuntime();
      if (rt && rt.state !== 'running' && rt.state !== 'stopping' && seconds > 0 && rt.lastRun && rt.lastRun.status !== 'ok') {
        // program crashed — keep waiting is pointless
        return;
      }
      await this.realWait(20);
    }
  }

  /** wait until predicate is true, up to `timeoutSim` simulation seconds */
  async until(pred: () => boolean, timeoutSim: number): Promise<boolean> {
    const end = sim.clock.now() + timeoutSim;
    while (sim.clock.now() < end) {
      if (pred()) return true;
      await this.realWait(20);
    }
    return pred();
  }

  term(): string {
    return useApp
      .getState()
      .term.map((l) => l.text)
      .join('');
  }

  vis(id: string): Record<string, any> {
    return sim.vis.get(id) ?? {};
  }

  setProp(id: string, key: string, value: any) {
    useApp.getState().setProp(id, key, value, false);
  }

  editDoc(fn: (d: ProjectDoc) => ProjectDoc) {
    const st = useApp.getState();
    st.setDoc(fn(structuredClone(st.doc)), { markDirty: false });
  }

  async press(id: string, simSeconds = 0.3) {
    sim.pressButton(id, true);
    await this.waitSim(simSeconds);
    sim.pressButton(id, false);
  }

  issueCodes(): string[] {
    return sim.issues.map((i) => i.code);
  }

  async http(method: string, path: string, body = '', headers: Record<string, string> = {}) {
    const rt = getRuntime();
    if (!rt) return { status: 0, headers: {}, body: '' };
    return rt.http(method, path, body, headers);
  }

  pyError() {
    return useApp.getState().pyError;
  }
}

export interface Scenario {
  id: string;
  name: string;
  expected: string;
  run(h: TestHost): Promise<TestResult>;
}

export interface ScenarioReport {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  expected: string;
  actual: string;
  error?: string;
  steps: string[];
  durationMs: number;
  screenshot?: string;
}

export async function runScenario(s: Scenario, speed = 1): Promise<ScenarioReport> {
  const h = new TestHost(speed);
  const t0 = performance.now();
  try {
    const r = await s.run(h);
    await h.stop();
    return { id: s.id, name: s.name, status: r.pass ? 'PASS' : 'FAIL', expected: s.expected, actual: r.actual, steps: [...h.steps, ...(r.details ?? [])], durationMs: performance.now() - t0 };
  } catch (e: any) {
    await h.stop().catch(() => {});
    return { id: s.id, name: s.name, status: 'ERROR', expected: s.expected, actual: '', error: String(e?.message ?? e), steps: h.steps, durationMs: performance.now() - t0 };
  }
}
