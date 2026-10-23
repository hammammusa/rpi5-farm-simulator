// Main-thread side of the Python runtime: owns the worker, answers its RPCs
// using the Simulator (the single source of truth for hardware state),
// and implements Stop (interrupt → hard terminate + respawn if ignored).

import type { Simulator } from '../engine/simulator';
import { SimError } from '../engine/simulator';
import { CTL, DATA_BYTES, createShared, type PyErrorInfo, type SharedBuffers, type WorkerOut } from './protocol';
import { SHIMS } from './shims';
import { dispatchPost, dispatchRpc, type DispatchHooks } from './dispatch';

export type RuntimeState = 'loading' | 'ready' | 'running' | 'stopping' | 'failed';

export interface RunResult {
  status: 'ok' | 'error' | 'stopped';
  error?: PyErrorInfo;
}

export interface RuntimeCallbacks {
  stdout(text: string): void;
  stderr(text: string): void;
  state(s: RuntimeState, detail?: string): void;
  done(r: RunResult, files: { name: string; content: string }[]): void;
  stdinRequest(): Promise<string>;
}

interface HttpPending {
  resolve(r: { status: number; headers: Record<string, string>; body: string }): void;
}

export class PythonRuntime {
  state: RuntimeState = 'loading';
  version = '';
  python = '';
  private worker: Worker | null = null;
  private shared!: SharedBuffers;
  private ctl!: Int32Array;
  private data!: Uint8Array;
  private interrupt!: Uint8Array;
  private stopTimer: any = null;
  private readyWaiters: (() => void)[] = [];
  private enc = new TextEncoder();
  private httpId = 1;
  private httpPending = new Map<number, HttpPending>();
  serverPort: number | null = null;
  lastRun: RunResult | null = null;
  private runWaiters: ((r: RunResult) => void)[] = [];

  constructor(private sim: Simulator, private cb: RuntimeCallbacks, private base: string) {
    this.boot();
  }

  static supported() {
    return typeof SharedArrayBuffer !== 'undefined' && (globalThis as any).crossOriginIsolated !== false;
  }

  private boot() {
    this.shared = createShared();
    this.ctl = new Int32Array(this.shared.ctl);
    this.data = new Uint8Array(this.shared.data);
    this.interrupt = new Uint8Array(this.shared.interrupt);
    this.sim.clock.attachShared(new Float64Array(this.shared.clock), new Int32Array(this.shared.ctl, CTL.CLOCK_SEQ * 4, 1));
    this.sim.onPythonEvent = () => {
      Atomics.add(this.ctl, CTL.EVENT_SEQ, 1);
      Atomics.notify(this.ctl, CTL.EVENT_SEQ);
    };
    this.setState('loading', 'Starting Python worker…');
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (ev: MessageEvent<WorkerOut>) => this.onMessage(ev.data);
    w.onerror = (ev) => {
      this.setState('failed', String(ev.message ?? 'worker error'));
    };
    w.postMessage({ type: 'init', base: this.base, shared: this.shared, tzOffset: -new Date().getTimezoneOffset() * 60, shims: SHIMS });
  }

  private setState(s: RuntimeState, detail?: string) {
    this.state = s;
    this.cb.state(s, detail);
  }

  whenReady(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    return new Promise((r) => this.readyWaiters.push(r));
  }

  /** resolves when the current run finishes */
  whenDone(): Promise<RunResult> {
    if (this.state !== 'running' && this.state !== 'stopping' && this.lastRun) return Promise.resolve(this.lastRun);
    return new Promise((r) => this.runWaiters.push(r));
  }

  async run(files: { name: string; content: string }[], main: string) {
    if (this.state === 'running' || this.state === 'stopping') await this.stop();
    await this.whenReady();
    this.lastRun = null;
    this.serverPort = null;
    Atomics.store(this.ctl, CTL.STOP, 0);
    this.interrupt[0] = 0;
    this.sim.programStart();
    this.setState('running');
    this.worker!.postMessage({ type: 'run', files, main });
  }

  /** Stop the running program. Resolves once execution has really ended. */
  stop(): Promise<void> {
    if (this.state !== 'running' && this.state !== 'stopping') return Promise.resolve();
    const done = this.whenDone().then(() => undefined);
    if (this.state === 'stopping') return done;
    this.setState('stopping');
    Atomics.store(this.ctl, CTL.STOP, 1);
    this.interrupt[0] = 2; // SIGINT → KeyboardInterrupt inside Python
    Atomics.notify(this.ctl, CTL.EVENT_SEQ);
    Atomics.notify(this.ctl, CTL.STOP);
    // release a pending synchronous RPC (e.g. waiting for input())
    this.respond({ ok: false, type: 'KeyboardInterrupt', msg: '' });
    this.stopTimer = setTimeout(() => this.hardStop(), 1500);
    return done;
  }

  /** The program ignored the interrupt (e.g. a bare `except:`): kill the worker and start a fresh one. */
  private hardStop() {
    if (this.state !== 'stopping') return;
    this.worker?.terminate();
    this.worker = null;
    this.cb.stderr('\n[simulator] Program did not respond to Stop — the Python worker was terminated and restarted.\n');
    this.finish({ status: 'stopped' }, []);
    this.boot();
  }

  restart() {
    this.worker?.terminate();
    this.worker = null;
    if (this.state === 'running' || this.state === 'stopping') this.finish({ status: 'stopped' }, []);
    this.boot();
  }

  private finish(r: RunResult, files: { name: string; content: string }[]) {
    clearTimeout(this.stopTimer);
    this.lastRun = r;
    this.sim.programEnd();
    this.serverPort = null;
    for (const p of this.httpPending.values()) p.resolve({ status: 502, headers: {}, body: 'Program stopped' });
    this.httpPending.clear();
    this.setState('ready');
    this.cb.done(r, files);
    const w = this.runWaiters;
    this.runWaiters = [];
    for (const f of w) f(r);
  }

  private onMessage(m: WorkerOut) {
    switch (m.type) {
      case 'status':
        this.cb.state(this.state, m.text);
        break;
      case 'ready':
        this.version = m.version;
        this.python = m.python;
        this.setState('ready', `Python ${m.python} (Pyodide ${m.version})`);
        for (const r of this.readyWaiters.splice(0)) r();
        break;
      case 'stdout':
        this.cb.stdout(m.text);
        break;
      case 'stderr':
        this.cb.stderr(m.text);
        break;
      case 'rpc':
        this.handleRpc(m.method, m.args, m.t);
        break;
      case 'post':
        try {
          this.handlePost(m.method, m.args, m.t);
        } catch (e: any) {
          this.cb.stderr(`[simulator] ${e?.message ?? e}\n`);
        }
        break;
      case 'done':
        this.finish({ status: m.status, error: m.error }, m.files ?? []);
        break;
      case 'fatal':
        this.cb.stderr(`[simulator] Python worker error: ${m.message}\n`);
        if (this.state === 'running' || this.state === 'stopping') this.finish({ status: 'error', error: { type: 'InternalError', message: m.message, traceback: m.message } }, []);
        else this.setState('failed', m.message);
        break;
    }
  }

  private respond(obj: any) {
    let bytes = this.enc.encode(JSON.stringify(obj));
    if (bytes.length > DATA_BYTES) bytes = this.enc.encode(JSON.stringify({ ok: false, type: 'MemoryError', msg: 'response too large' }));
    this.data.set(bytes);
    Atomics.store(this.ctl, CTL.RPC_LEN, bytes.length);
    Atomics.store(this.ctl, CTL.RPC_STATE, 1);
    Atomics.notify(this.ctl, CTL.RPC_STATE);
  }

  private async handleRpc(method: string, a: any, t: number) {
    try {
      const v = await this.dispatch(method, a, t);
      this.respond({ ok: true, v: v ?? null });
    } catch (e: any) {
      if (e instanceof SimError) this.respond({ ok: false, type: e.pyType, msg: e.message });
      else this.respond({ ok: false, type: 'RuntimeError', msg: String(e?.message ?? e) });
    }
  }

  private hooks: DispatchHooks = {
    serve: (port) => {
      this.serverPort = port;
    },
    stdin: () => this.cb.stdinRequest(),
    httpResponse: (a) => {
      const p = this.httpPending.get(a.id);
      if (p) {
        this.httpPending.delete(a.id);
        p.resolve({ status: a.status, headers: a.headers ?? {}, body: a.body ?? '' });
      }
    },
  };

  private dispatch(method: string, a: any, t: number): any {
    return dispatchRpc(this.sim, method, a, t, this.hooks);
  }

  private handlePost(method: string, a: any, t: number) {
    dispatchPost(this.sim, method, a, t, this.hooks);
  }

  /** Virtual HTTP request from the in-app browser to the Python web server. */
  http(method: string, url: string, body = '', headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    if (this.state !== 'running' || this.serverPort === null)
      return Promise.resolve({ status: 0, headers: {}, body: '' });
    const id = this.httpId++;
    const u = new URL(url, 'http://raspberrypi.local:5000');
    return new Promise((resolve) => {
      this.httpPending.set(id, { resolve });
      this.sim.pushEvent({ k: 'http', id, method, path: u.pathname, query: u.search.slice(1), body, headers });
      setTimeout(() => {
        if (this.httpPending.has(id)) {
          this.httpPending.delete(id);
          resolve({ status: 504, headers: {}, body: 'Gateway timeout: the Python program did not answer within 10 s (it only serves requests while it is inside sleep(), app.run() or another wait).' });
        }
      }, 10000);
    });
  }
}
