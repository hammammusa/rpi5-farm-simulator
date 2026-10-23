// Runs the real Python shims in Node Pyodide against the real Simulator, with a
// virtual wall clock: whenever Python waits, simulated time jumps forward
// instantly, so multi-second programs run in milliseconds and deterministically.
import { loadPyodide } from 'pyodide';
import { Simulator } from '../../src/engine/simulator';
import type { ProjectDoc } from '../../src/engine/types';
import { SHIMS } from '../../src/runtime/shims';
import { dispatchPost, dispatchRpc, rpcResult, type DispatchHooks } from '../../src/runtime/dispatch';

let pyPromise: Promise<any> | null = null;
let current: Harness | null = null;

export interface RunOutput {
  status: string;
  error: any;
  stdout: string;
  stderr: string;
}

export class Harness {
  wall = 0;
  sim: Simulator;
  seq = 0;
  seen = 0;
  stop = false;
  limit = Infinity;
  stdout = '';
  stderr = '';
  stdinLines: string[] = [];
  /** called on every Python wait with current sim time: lets tests change sensors mid-run */
  onWait: ((h: Harness) => void) | null = null;
  serving: number | null = null;
  responses = new Map<number, any>();
  hooks: DispatchHooks = {
    serve: (p) => (this.serving = p),
    stdin: () => this.stdinLines.shift() ?? '',
    httpResponse: (a) => this.responses.set(a.id, a),
  };

  constructor(doc: ProjectDoc) {
    this.sim = new Simulator(doc, Date.UTC(2026, 4, 1, 8, 0, 0));
    // rebuild the clock on the virtual wall
    const start = this.sim.clock.nowMs();
    (this.sim.clock as any).wall = () => this.wall;
    this.sim.clock.epoch = start;
    this.sim.clock.anchor = 0;
    this.sim.farm.reset(doc.farm, this.sim.clock.now());
    this.sim.onPythonEvent = () => {
      this.seq++;
    };
  }

  now() {
    return this.sim.clock.now();
  }

  advance(simSeconds: number) {
    const sp = this.sim.clock.speed || 1;
    this.wall += (simSeconds * 1000) / sp;
    this.sim.tick();
  }

  js() {
    return {
      rpc: (m: string, j: string) => {
        if (m === 'events.take') this.seen = this.seq;
        const a = JSON.parse(j);
        return JSON.stringify(rpcResult(() => dispatchRpc(this.sim, m, a, this.now(), this.hooks)));
      },
      post: (m: string, j: string) => {
        dispatchPost(this.sim, m, JSON.parse(j), this.now(), this.hooks);
      },
      wait: (sec: number, ignore: boolean) => {
        if (this.stop) return 2;
        if (!ignore && this.seq !== this.seen) return 1;
        // advance in small steps so ticks (patterns, farm, pulses) happen in order
        let rem = Math.max(0, sec);
        while (rem > 1e-9) {
          const step = Math.min(rem, 0.05);
          this.advance(step);
          rem -= step;
          this.onWait?.(this);
          if (this.now() - this.t0 > this.limit) {
            this.stop = true;
            return 2;
          }
          if (!ignore && this.seq !== this.seen) return 1;
        }
        if (sec === 0) this.advance(0.0001);
        return this.seq !== this.seen && !ignore ? 1 : 0;
      },
      now: () => this.now(),
      stopped: () => this.stop,
      has_events: () => this.seq !== this.seen,
      tz_offset: 0,
    };
  }

  t0 = 0;

  async run(code: string, opts: { files?: Record<string, string>; seconds?: number } = {}): Promise<RunOutput> {
    const py = await getPy();
    current = this;
    this.limit = opts.seconds ?? 30;
    this.t0 = this.now();
    this.stdout = '';
    this.stderr = '';
    this.stop = false;
    this.sim.programStart();
    const FS = py.FS;
    try {
      py.runPython("import shutil, os\nshutil.rmtree('/home/pi/project', ignore_errors=True)\nos.makedirs('/home/pi/project', exist_ok=True)");
    } catch {
      /* first run */
    }
    const files = { 'main.py': code, ...(opts.files ?? {}) };
    for (const [n, c] of Object.entries(files)) {
      const full = `/home/pi/project/${n}`;
      py.runPython(`import os; os.makedirs(os.path.dirname(${JSON.stringify(full)}), exist_ok=True)`);
      FS.writeFile(full, c);
    }
    py.globals.set('_sim_main', '/home/pi/project/main.py');
    const res = JSON.parse(py.runPython('import _simcore\n_simcore.run_main(_sim_main)'));
    this.sim.programEnd();
    return { status: res.status, error: res.error, stdout: this.stdout, stderr: this.stderr };
  }
}

async function getPy() {
  if (!pyPromise) {
    pyPromise = (async () => {
      const py = await loadPyodide({ indexURL: 'node_modules/pyodide/' });
      py.setStdout({ batched: (s: string) => current && (current.stdout += s + '\n') });
      py.setStderr({ batched: (s: string) => current && (current.stderr += s + '\n') });
      py.setStdin({ stdin: () => current?.stdinLines.shift() ?? '' });
      const proxy: any = {};
      for (const k of ['rpc', 'post', 'wait', 'now', 'stopped', 'has_events'])
        proxy[k] = (...args: any[]) => (current!.js() as any)[k](...args);
      proxy.tz_offset = 0;
      py.registerJsModule('_simjs', proxy);
      for (const [path, src] of Object.entries(SHIMS)) {
        const full = `/lib/sim/${path}`;
        py.runPython(`import os; os.makedirs(os.path.dirname(${JSON.stringify(full)}), exist_ok=True)`);
        py.FS.writeFile(full, src);
      }
      py.runPython("import sys\nsys.path.insert(0, '/lib/sim')\nimport _simcore\n_simcore.install()");
      return py;
    })();
  }
  return pyPromise;
}
