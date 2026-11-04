/// <reference lib="webworker" />
// Web Worker that runs the program of ONE microcontroller (ESP32 MicroPython). The program
// never runs on the page's main thread; every hardware access is a synchronous call to the
// simulation engine on the main thread through SharedArrayBuffers. A fresh worker is used
// for every run, so Stop can always end a program (even a busy loop) by terminating it.
import { readSharedClock } from '../../engine/clock';
import { CTL } from '../protocol';
import { runMicroPython, StopSignal, type McuHostIO } from './mpHost';
import type { McuWorkerIn, McuWorkerOut } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let ctl!: Int32Array;
let data!: Uint8Array;
let clockF!: Float64Array;
let clockSeq!: Int32Array;
let seenSeq = 0;
const dec = new TextDecoder();
let outBuf = '';
let errBuf = '';
let lastFlush = 0;
let postCount = 0;
let postWindow = 0;

const send = (m: McuWorkerOut) => self.postMessage(m);

function flush() {
  if (outBuf) send({ type: 'stdout', text: outBuf });
  if (errBuf) send({ type: 'stderr', text: errBuf });
  outBuf = '';
  errBuf = '';
  lastFlush = performance.now();
}

function maybeFlush() {
  if (outBuf.length + errBuf.length > 8192 || performance.now() - lastFlush > 40) flush();
}

const simNow = () => readSharedClock(clockF, clockSeq);
const stopped = () => Atomics.load(ctl, CTL.STOP) === 1;

function rpc(method: string, args: any): any {
  if (stopped()) throw new StopSignal();
  flush();
  if (method === 'events.take') seenSeq = Atomics.load(ctl, CTL.EVENT_SEQ);
  Atomics.store(ctl, CTL.RPC_STATE, 0);
  send({ type: 'rpc', method, args, t: simNow() });
  for (;;) {
    const r = Atomics.wait(ctl, CTL.RPC_STATE, 0, 250);
    if (r !== 'timed-out' || Atomics.load(ctl, CTL.RPC_STATE) === 1) break;
  }
  const res = JSON.parse(dec.decode(data.slice(0, Atomics.load(ctl, CTL.RPC_LEN))));
  if (res.ok) return res.v;
  if (res.type === 'Stop' || stopped()) throw new StopSignal();
  throw { type: res.type, message: res.msg };
}

function post(method: string, args: any) {
  if (stopped()) throw new StopSignal();
  send({ type: 'post', method, args, t: simNow() });
  // back-pressure for tight loops that never wait
  const now = performance.now();
  if (now - postWindow > 100) {
    postWindow = now;
    postCount = 0;
  }
  if (++postCount > 1500) {
    flush();
    Atomics.wait(ctl, CTL.STOP, 0, 5);
    postWindow = performance.now();
    postCount = 0;
  }
  maybeFlush();
}

/** wait up to `ms` of simulation time; 1 = events pending */
function wait(ms: number): 0 | 1 {
  flush();
  const target = simNow() + Math.max(0, ms) / 1000;
  for (;;) {
    if (stopped()) throw new StopSignal();
    if (Atomics.load(ctl, CTL.EVENT_SEQ) !== seenSeq) return 1;
    const rem = target - simNow();
    if (rem <= 0) return 0;
    const sp = clockF[2];
    const realMs = sp > 0 ? Math.min((rem * 1000) / sp, 50) : 50;
    const seq = Atomics.load(ctl, CTL.EVENT_SEQ);
    if (seq === seenSeq) Atomics.wait(ctl, CTL.EVENT_SEQ, seq, Math.max(0.5, realMs));
  }
}

self.onmessage = async (ev: MessageEvent<McuWorkerIn>) => {
  const m = ev.data;
  if (m.type !== 'run') return;
  ctl = new Int32Array(m.shared.ctl);
  data = new Uint8Array(m.shared.data);
  clockF = new Float64Array(m.shared.clock);
  clockSeq = new Int32Array(m.shared.ctl, CTL.CLOCK_SEQ * 4, 1);
  seenSeq = Atomics.load(ctl, CTL.EVENT_SEQ);
  try {
    if (m.lang !== 'micropython') throw new Error(`language ${m.lang} is not available in this worker`);
    send({ type: 'status', text: 'Loading MicroPython…' });
    const mod = await import(/* @vite-ignore */ `${m.base}micropython/micropython.mjs`);
    const t0 = simNow();
    const io: McuHostIO = {
      call: rpc,
      post,
      wait,
      ticksMs: () => (simNow() - t0) * 1000,
      epoch: () => simNow(),
      tz: () => m.tzOffset,
      stdout: (t) => {
        outBuf += t;
        maybeFlush();
      },
      stderr: (t) => {
        errBuf += t;
        maybeFlush();
      },
    };
    send({ type: 'started', engine: 'MicroPython 1.29 (WebAssembly port)' });
    const r = await runMicroPython(mod.loadMicroPython, m.files, m.main, m.folder, io);
    flush();
    send({ type: 'done', status: r.status, error: r.error });
  } catch (e: any) {
    flush();
    if (e instanceof StopSignal) send({ type: 'done', status: 'stopped' });
    else send({ type: 'fatal', message: String(e?.message ?? e) });
  }
};
