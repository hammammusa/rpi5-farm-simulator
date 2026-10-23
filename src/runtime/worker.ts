/// <reference lib="webworker" />
// Dedicated Web Worker that runs real CPython (Pyodide/WebAssembly).
// User code never runs on the page's main thread. Blocking operations
// (sleep, GPIO reads, serial reads) block only this worker, using
// Atomics.wait on SharedArrayBuffers; Stop sets Pyodide's interrupt buffer.

import { readSharedClock } from '../engine/clock';
import { CTL, type WorkerIn, type WorkerOut } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let py: any = null;
let ctl!: Int32Array;
let data!: Uint8Array;
let clockF!: Float64Array;
let clockSeq!: Int32Array;
let interrupt!: Uint8Array;
let seenSeq = 0;
const dec = new TextDecoder();
const enc = new TextEncoder();

let outBuf = '';
let errBuf = '';
let lastFlush = 0;
let postCount = 0;
let postWindow = 0;

function send(m: WorkerOut) {
  self.postMessage(m);
}

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

function simNow() {
  return readSharedClock(clockF, clockSeq);
}

function speed() {
  return clockF[2];
}

function stopped() {
  return Atomics.load(ctl, CTL.STOP) === 1;
}

/** Synchronous request to the simulation engine on the main thread. */
function rpc(method: string, argsJson: string): string {
  flush();
  if (method === 'events.take') seenSeq = Atomics.load(ctl, CTL.EVENT_SEQ);
  Atomics.store(ctl, CTL.RPC_STATE, 0);
  send({ type: 'rpc', method, args: JSON.parse(argsJson), t: simNow() });
  for (;;) {
    const r = Atomics.wait(ctl, CTL.RPC_STATE, 0, 250);
    if (r !== 'timed-out' || Atomics.load(ctl, CTL.RPC_STATE) === 1) break;
  }
  const len = Atomics.load(ctl, CTL.RPC_LEN);
  return dec.decode(data.slice(0, len));
}

/** Fire-and-forget notification (GPIO writes etc.), timestamped with simulation time. */
function post(method: string, argsJson: string) {
  send({ type: 'post', method, args: JSON.parse(argsJson), t: simNow() });
  // back-pressure for tight loops without sleep()
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

/**
 * Block for up to `simSeconds` of simulation time.
 * Returns 0 on timeout, 1 if events are pending for Python, 2 if stop was requested.
 */
function wait(simSeconds: number, ignoreEvents: boolean): number {
  flush();
  const target = simNow() + Math.max(0, simSeconds);
  for (;;) {
    if (stopped()) return 2;
    if (!ignoreEvents && Atomics.load(ctl, CTL.EVENT_SEQ) !== seenSeq) return 1;
    const rem = target - simNow();
    if (rem <= 0) return 0;
    const sp = speed();
    // cap each wait so speed changes and fast-forward are picked up quickly
    const realMs = sp > 0 ? Math.min((rem * 1000) / sp, 50) : 50;
    const seq = Atomics.load(ctl, CTL.EVENT_SEQ);
    if (ignoreEvents) Atomics.wait(ctl, CTL.STOP, 0, Math.max(0.5, realMs));
    else if (seq === seenSeq) Atomics.wait(ctl, CTL.EVENT_SEQ, seq, Math.max(0.5, realMs));
  }
}

function hasEvents() {
  return Atomics.load(ctl, CTL.EVENT_SEQ) !== seenSeq;
}

async function init(msg: Extract<WorkerIn, { type: 'init' }>) {
  ctl = new Int32Array(msg.shared.ctl);
  data = new Uint8Array(msg.shared.data);
  clockF = new Float64Array(msg.shared.clock);
  clockSeq = new Int32Array(msg.shared.ctl, CTL.CLOCK_SEQ * 4, 1);
  interrupt = new Uint8Array(msg.shared.interrupt);
  send({ type: 'status', text: 'Loading Python runtime (Pyodide)…' });
  const url = `${msg.base}pyodide/pyodide.mjs`;
  const mod = await import(/* @vite-ignore */ url);
  py = await mod.loadPyodide({
    indexURL: `${msg.base}pyodide/`,
    stdout: undefined,
    stderr: undefined,
  });
  py.setStdout({
    write: (buf: Uint8Array) => {
      outBuf += dec.decode(buf);
      maybeFlush();
      return buf.length;
    },
    isatty: false,
  });
  py.setStderr({
    write: (buf: Uint8Array) => {
      errBuf += dec.decode(buf);
      maybeFlush();
      return buf.length;
    },
    isatty: false,
  });
  py.setStdin({
    stdin: () => {
      const r = JSON.parse(rpc('stdin.readline', '{}'));
      if (!r.ok) return null;
      return r.v as string;
    },
  });
  py.setInterruptBuffer(interrupt);
  py.registerJsModule('_simjs', {
    rpc,
    post,
    wait,
    now: simNow,
    stopped,
    has_events: hasEvents,
    tz_offset: msg.tzOffset,
  });
  // install shim modules into the in-memory filesystem
  const FS = py.FS;
  const root = '/lib/sim';
  mkdirp(FS, root);
  for (const [path, src] of Object.entries(msg.shims)) {
    const full = `${root}/${path}`;
    mkdirp(FS, full.slice(0, full.lastIndexOf('/')));
    FS.writeFile(full, src);
  }
  py.runPython(`
import sys
sys.path.insert(0, '/lib/sim')
import _simcore
_simcore.install()
`);
  const pyver = py.runPython('import sys; sys.version.split()[0]');
  send({ type: 'ready', version: py.version, python: pyver });
}

function mkdirp(FS: any, dir: string) {
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    try {
      FS.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

function rmrf(FS: any, dir: string) {
  let entries: string[] = [];
  try {
    entries = FS.readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === '.' || e === '..') continue;
    const p = `${dir}/${e}`;
    const st = FS.stat(p);
    if (FS.isDir(st.mode)) {
      rmrf(FS, p);
      FS.rmdir(p);
    } else FS.unlink(p);
  }
}

function listFiles(FS: any, dir: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = FS.readdir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === '.' || e === '..' || e === '__pycache__') continue;
    const p = `${dir}/${e}`;
    const st = FS.stat(p);
    if (FS.isDir(st.mode)) out.push(...listFiles(FS, p, `${prefix}${e}/`));
    else if (st.size < 256 * 1024) out.push(`${prefix}${e}`);
  }
  return out;
}

const PROJECT = '/home/pi/project';

async function run(msg: Extract<WorkerIn, { type: 'run' }>) {
  const FS = py.FS;
  Atomics.store(ctl, CTL.STOP, 0);
  interrupt[0] = 0;
  seenSeq = Atomics.load(ctl, CTL.EVENT_SEQ);
  mkdirp(FS, PROJECT);
  rmrf(FS, PROJECT);
  const original = new Map<string, string>();
  for (const f of msg.files) {
    const full = `${PROJECT}/${f.name}`;
    mkdirp(FS, full.slice(0, full.lastIndexOf('/')));
    FS.writeFile(full, f.content);
    original.set(f.name, f.content);
  }
  let result: any;
  try {
    py.globals.set('_sim_main', `${PROJECT}/${msg.main}`);
    result = py.runPython(`
import _simcore
_simcore.run_main(_sim_main)
`);
  } catch (e: any) {
    result = JSON.stringify({ status: 'error', error: { type: 'InternalError', message: String(e?.message ?? e), traceback: String(e?.message ?? e) } });
  }
  flush();
  const res = JSON.parse(String(result));
  // sync back files created/modified by the program (e.g. settings.json, logs)
  const changed: { name: string; content: string }[] = [];
  for (const name of listFiles(FS, PROJECT)) {
    if (name.endsWith('.pyc')) continue;
    try {
      const content = dec.decode(FS.readFile(`${PROJECT}/${name}`));
      if (original.get(name) !== content) changed.push({ name, content });
    } catch {
      /* binary */
    }
  }
  send({ type: 'done', status: res.status, error: res.error, files: changed });
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') await init(msg);
    else if (msg.type === 'run') await run(msg);
  } catch (e: any) {
    send({ type: 'fatal', message: String(e?.stack ?? e?.message ?? e) });
  }
};

export {};
void enc;
