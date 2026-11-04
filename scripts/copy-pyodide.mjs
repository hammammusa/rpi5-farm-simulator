// Copies the WebAssembly runtimes from node_modules into public/ so the app is fully
// self-hosted (no CDN dependency at runtime): Pyodide (Raspberry Pi Python), MicroPython
// (ESP32) and the YoWASP Clang/LLD toolchain (Arduino C++ for ESP32, loaded only when an
// Arduino sketch is compiled).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function copy(pkg, dest, files) {
  const src = join('node_modules', ...pkg.split('/'));
  if (!existsSync(src)) {
    console.warn(`[copy-runtimes] node_modules/${pkg} not found, skipping`);
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const f of files(src)) if (existsSync(join(src, f))) cpSync(join(src, f), join(dest, f.split('/').pop()));
  console.log('[copy-runtimes] copied', pkg, 'to', dest);
}

copy('pyodide', join('public', 'pyodide'), () => ['pyodide.asm.js', 'pyodide.asm.wasm', 'pyodide.mjs', 'pyodide.js', 'python_stdlib.zip', 'pyodide-lock.json']);
copy('@micropython/micropython-webassembly-pyscript', join('public', 'micropython'), () => ['micropython.mjs', 'micropython.wasm']);
copy('@yowasp/clang', join('public', 'clang'), (src) => readdirSync(join(src, 'gen')).map((f) => `gen/${f}`));
