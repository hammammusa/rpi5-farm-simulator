// Singletons tying the store, the simulator and the Python runtime together.
import { useSyncExternalStore } from 'react';
import { Simulator } from '../engine/simulator';
import { PythonRuntime, type RunResult } from '../runtime/bridge';
import { useApp } from './store';
import { lastProjectId, loadProject as idbLoad, saveProject } from './persist';
import { translate } from '../i18n';
import { pyErrorText } from '../i18n';

export const sim = new Simulator(useApp.getState().doc);
let runtime: PythonRuntime | null = null;
let stdinResolve: ((s: string) => void) | null = null;

// keep the simulator in sync with the document
let lastDoc = useApp.getState().doc;
useApp.subscribe((s) => {
  if (s.doc !== lastDoc) {
    const replaced = s.doc.id !== lastDoc.id;
    lastDoc = s.doc;
    sim.setDoc(s.doc);
    if (replaced) {
      sim.resetSimulation();
      sim.clock.setSpeed(s.doc.sim?.speed ?? 1);
    }
  }
});

export function getRuntime(): PythonRuntime | null {
  return runtime;
}

export function startRuntime() {
  if (runtime) return runtime;
  const st = useApp.getState();
  if (typeof SharedArrayBuffer === 'undefined' || !(globalThis as any).crossOriginIsolated) {
    st.setRuntime('failed', 'This page is not cross-origin isolated, so SharedArrayBuffer is unavailable. Reload the page (the service worker enables isolation on the first load).');
    return null;
  }
  runtime = new PythonRuntime(
    sim,
    {
      stdout: (t) => useApp.getState().termWrite('out', t),
      stderr: (t) => useApp.getState().termWrite('err', t),
      state: (s, d) => useApp.getState().setRuntime(s, d),
      done: (r: RunResult, files) => onDone(r, files),
      stdinRequest: () =>
        new Promise<string>((resolve) => {
          stdinResolve = resolve;
          useApp.getState().setStdinPending(true);
          useApp.getState().setDock('terminal');
        }),
    },
    import.meta.env.BASE_URL,
  );
  return runtime;
}

export function submitStdin(text: string) {
  const r = stdinResolve;
  stdinResolve = null;
  useApp.getState().setStdinPending(false);
  useApp.getState().termWrite('in', text + '\n');
  r?.(text + '\n');
}

function onDone(r: RunResult, files: { name: string; content: string }[]) {
  const st = useApp.getState();
  st.setStdinPending(false);
  stdinResolve = null;
  const T = (s: string, p?: any) => translate(st.lang, s, p);
  if (r.status === 'ok') st.termWrite('sys', `\n${T('Program finished.')}\n`);
  else if (r.status === 'stopped') st.termWrite('sys', `\n${T('Program stopped.')}\n`);
  else if (r.error) {
    st.setPyError({ ...r.error });
    const hint = pyErrorText(st.lang, r.error.type);
    if (hint) st.termWrite('sys', `💡 ${hint}\n`);
    st.setDock('terminal');
  }
  // files the program created or changed (data logs, settings) appear in the explorer
  if (files.length) {
    const doc = useApp.getState().doc;
    let fs = doc.files.slice();
    for (const f of files) {
      if (!/\.(py|txt|json|csv|log|html|md)$/i.test(f.name)) continue;
      const i = fs.findIndex((x) => x.name === f.name);
      if (i >= 0) fs[i] = { ...fs[i], content: f.content };
      else fs.push(f);
    }
    useApp.getState().setDoc({ ...doc, files: fs });
  }
}

export async function runProgram() {
  const st = useApp.getState();
  const rt = startRuntime();
  if (!rt) return;
  st.setPyError(null);
  st.termClear();
  st.termWrite('sys', `$ python3 ${st.doc.mainFile}\n`);
  if (rt.state === 'loading') st.termWrite('sys', translate(st.lang, 'Python is still loading — the program will start in a moment…') + '\n');
  await rt.run(st.doc.files, st.doc.mainFile);
}

export async function stopProgram() {
  await runtime?.stop();
}

export function resetSimulation() {
  sim.resetSimulation();
}

export function setSpeed(s: number) {
  sim.clock.setSpeed(s);
  useApp.getState().setSpeed(s);
  const d = useApp.getState().doc;
  useApp.getState().setDoc({ ...d, sim: { ...d.sim, speed: s } }, { markDirty: true });
}

// ------------------------------------------------------------ react binding
let ver = 0;
let scheduled = false;
const subs = new Set<() => void>();
sim.subscribe(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ver = sim.version;
    for (const s of subs) s();
  });
});

/** Re-render when the simulation state changes (at most once per animation frame). */
export function useSimVersion() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => ver,
  );
}

// ------------------------------------------------------------ main loop + autosave
let tickTimer: any = null;
export function startLoop() {
  if (tickTimer) return;
  tickTimer = setInterval(() => sim.tick(), 40);
}

let saveTimer: any = null;
useApp.subscribe((s, prev) => {
  if (s.doc !== prev.doc && s.dirty) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), 1200);
  }
});

export async function saveNow() {
  const st = useApp.getState();
  try {
    await saveProject(st.doc);
    useApp.setState({ dirty: false, savedAt: Date.now() });
  } catch (e) {
    console.warn('save failed', e);
  }
}

export async function restoreLast(): Promise<boolean> {
  const id = await lastProjectId();
  if (!id) return false;
  const d = await idbLoad(id);
  if (!d) return false;
  useApp.getState().loadProject(d);
  return true;
}

// expose for automated tests and debugging
(globalThis as any).__rpi5sim = { sim, useApp, runProgram, stopProgram, getRuntime, saveNow };
