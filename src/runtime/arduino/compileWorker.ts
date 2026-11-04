/// <reference lib="webworker" />
// Persistent worker holding the Clang/LLD toolchain (LLVM 22 compiled to WebAssembly, YoWASP).
// The toolchain (≈105 MB) is downloaded once and then served from the browser cache.
import { compileArduino } from './arduinoHost';

declare const self: DedicatedWorkerGlobalScope;

export type CompileIn = { id: number; base: string; files: { name: string; content: string }[]; main: string; folder: string };
export type CompileOut =
  | { id: number; type: 'progress'; text: string }
  | { id: number; type: 'result'; ok: boolean; wasm?: Uint8Array; error?: any; log: string; ms: number };

let clang: Promise<any> | null = null;

self.onmessage = async (ev: MessageEvent<CompileIn>) => {
  const m = ev.data;
  try {
    if (!clang) {
      self.postMessage({ id: m.id, type: 'progress', text: 'Loading the C++ compiler (Clang/LLVM, ≈105 MB on the first use)…' } satisfies CompileOut);
      clang = import(/* @vite-ignore */ `${m.base}clang/bundle.js`);
    }
    const mod = await clang;
    self.postMessage({ id: m.id, type: 'progress', text: 'Compiling the sketch with Clang…' } satisfies CompileOut);
    const r = await compileArduino(mod.runClang, m.files, m.main, m.folder);
    self.postMessage({ id: m.id, type: 'result', ok: r.ok, wasm: r.wasm, error: r.error, log: r.log, ms: r.ms } satisfies CompileOut, r.wasm ? [r.wasm.buffer as ArrayBuffer] : []);
  } catch (e: any) {
    clang = null;
    self.postMessage({ id: m.id, type: 'result', ok: false, log: String(e?.message ?? e), ms: 0, error: { type: 'CompilerUnavailable', message: `The C++ compiler could not be loaded: ${e?.message ?? e}`, traceback: '' } } satisfies CompileOut);
  }
};
