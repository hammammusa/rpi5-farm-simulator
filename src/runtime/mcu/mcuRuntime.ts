// Main-thread side of a microcontroller program: one McuRuntime per controller component.
// It starts a fresh worker for each run, answers the worker's engine calls with the shared
// Simulator (bound to this controller's id), shares the virtual clock and implements
// Stop (stop flag → terminate after a short grace period) and board reset.
import { SimError, type Simulator } from '../../engine/simulator';
import type { LanguageId } from '../../engine/boards/types';
import { CTL, DATA_BYTES, createShared, type PyErrorInfo, type SharedBuffers } from '../protocol';
import { mcuCall, mcuPost, type McuHooks } from './dispatch';
import type { McuWorkerOut } from './protocol';

export type McuState = 'idle' | 'loading' | 'running' | 'stopping';

export interface McuRunResult {
  status: 'ok' | 'error' | 'stopped' | 'reset';
  error?: PyErrorInfo;
}

export interface McuCallbacks {
  stdout(text: string): void;
  stderr(text: string): void;
  state(s: McuState, detail?: string): void;
  done(r: McuRunResult): void;
}

export class McuRuntime {
  state: McuState = 'idle';
  engine = '';
  lastRun: McuRunResult | null = null;
  private worker: Worker | null = null;
  private shared!: SharedBuffers;
  private ctl!: Int32Array;
  private data!: Uint8Array;
  private detachClock: (() => void) | null = null;
  private stopTimer: any = null;
  private waiters: ((r: McuRunResult) => void)[] = [];
  private enc = new TextEncoder();
  private hooks: McuHooks;

  constructor(
    private sim: Simulator,
    readonly id: string,
    private cb: McuCallbacks,
    private base: string,
  ) {
    this.hooks = { console: (t) => this.cb.stdout(t) };
  }

  private setState(s: McuState, detail?: string) {
    this.state = s;
    this.cb.state(s, detail);
  }

  get busy() {
    return this.state !== 'idle';
  }

  whenDone(): Promise<McuRunResult> {
    if (!this.busy && this.lastRun) return Promise.resolve(this.lastRun);
    return new Promise((r) => this.waiters.push(r));
  }

  async run(lang: LanguageId, files: { name: string; content: string }[], main: string) {
    if (this.busy) await this.stop();
    this.lastRun = null;
    this.shared = createShared();
    this.ctl = new Int32Array(this.shared.ctl);
    this.data = new Uint8Array(this.shared.data);
    this.detachClock = this.sim.clock.attachShared(new Float64Array(this.shared.clock), new Int32Array(this.shared.ctl, CTL.CLOCK_SEQ * 4, 1));
    this.sim.controllerStart(this.id);
    const io = this.sim.controller(this.id);
    io.onEvent = () => {
      Atomics.add(this.ctl, CTL.EVENT_SEQ, 1);
      Atomics.notify(this.ctl, CTL.EVENT_SEQ);
    };
    this.setState('loading', 'Loading MicroPython…');
    const w = new Worker(new URL('./mcuWorker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (ev: MessageEvent<McuWorkerOut>) => this.onMessage(w, ev.data);
    w.onerror = (ev) => {
      if (this.worker !== w) return;
      this.cb.stderr(`[simulator] worker error: ${ev.message ?? ev}\n`);
      this.finish({ status: 'error', error: { type: 'InternalError', message: String(ev.message ?? 'worker error'), traceback: '' } });
    };
    w.postMessage({ type: 'run', lang, base: this.base, shared: this.shared, tzOffset: -new Date().getTimezoneOffset() * 60, files, main, folder: this.id });
  }

  /** Stop the program; resolves once it has really ended. */
  stop(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    const done = this.whenDone().then(() => undefined);
    if (this.state === 'stopping') return done;
    this.setState('stopping');
    Atomics.store(this.ctl, CTL.STOP, 1);
    Atomics.notify(this.ctl, CTL.EVENT_SEQ);
    Atomics.notify(this.ctl, CTL.STOP);
    this.respond({ ok: false, type: 'Stop', msg: '' });
    // a program in a busy loop never reaches a simulator call: end the worker
    this.stopTimer = setTimeout(() => this.finish({ status: 'stopped' }), 600);
    return done;
  }

  private finish(r: McuRunResult) {
    clearTimeout(this.stopTimer);
    this.worker?.terminate();
    this.worker = null;
    this.detachClock?.();
    this.detachClock = null;
    this.sim.controller(this.id).onEvent = () => {};
    this.sim.controllerEnd(this.id);
    this.lastRun = r;
    this.setState('idle');
    this.cb.done(r);
    for (const f of this.waiters.splice(0)) f(r);
  }

  private respond(obj: any) {
    let bytes = this.enc.encode(JSON.stringify(obj));
    if (bytes.length > DATA_BYTES) bytes = this.enc.encode(JSON.stringify({ ok: false, type: 'MemoryError', msg: 'response too large' }));
    this.data.set(bytes);
    Atomics.store(this.ctl, CTL.RPC_LEN, bytes.length);
    Atomics.store(this.ctl, CTL.RPC_STATE, 1);
    Atomics.notify(this.ctl, CTL.RPC_STATE);
  }

  private onMessage(w: Worker, m: McuWorkerOut) {
    if (this.worker !== w) return;
    switch (m.type) {
      case 'status':
        this.cb.state(this.state, m.text);
        break;
      case 'started':
        this.engine = m.engine;
        if (this.state === 'loading') this.setState('running', m.engine);
        break;
      case 'stdout':
        this.cb.stdout(m.text);
        break;
      case 'stderr':
        this.cb.stderr(m.text);
        break;
      case 'rpc':
        try {
          this.respond({ ok: true, v: mcuCall(this.sim, this.id, m.method, m.args, m.t, this.hooks) ?? null });
        } catch (e: any) {
          if (e instanceof SimError) this.respond({ ok: false, type: e.pyType, msg: e.message });
          else this.respond({ ok: false, type: 'RuntimeError', msg: String(e?.message ?? e) });
        }
        break;
      case 'post':
        mcuPost(this.sim, this.id, m.method, m.args, m.t, this.hooks);
        break;
      case 'done':
        this.finish({ status: this.state === 'stopping' ? 'stopped' : m.status, error: m.error });
        break;
      case 'fatal':
        this.cb.stderr(`[simulator] ${m.message}\n`);
        this.finish({ status: 'error', error: { type: 'InternalError', message: m.message, traceback: m.message } });
        break;
    }
  }
}
