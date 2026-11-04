// Main-thread access to the persistent compiler worker (one for the whole app).
import type { CompileIn, CompileOut } from './compileWorker';

export interface BrowserCompileResult {
  ok: boolean;
  wasm?: Uint8Array;
  error?: any;
  log: string;
  ms: number;
}

let worker: Worker | null = null;
let seq = 1;
const pending = new Map<number, { resolve(r: BrowserCompileResult): void; progress(t: string): void }>();

function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL('./compileWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<CompileOut>) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.progress(m.text);
    else {
      pending.delete(m.id);
      p.resolve(m);
    }
  };
  worker.onerror = (ev) => {
    for (const [id, p] of pending) p.resolve({ ok: false, log: String(ev.message), ms: 0, error: { type: 'CompilerUnavailable', message: String(ev.message ?? 'compiler worker failed'), traceback: '' } }), pending.delete(id);
    worker = null;
  };
  return worker;
}

export function compileSketch(base: string, files: { name: string; content: string }[], main: string, folder: string, progress: (t: string) => void): Promise<BrowserCompileResult> {
  const id = seq++;
  return new Promise((resolve) => {
    pending.set(id, { resolve, progress });
    ensure().postMessage({ id, base, files, main, folder } satisfies CompileIn);
  });
}
