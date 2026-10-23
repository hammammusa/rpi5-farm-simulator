// Copies the Pyodide runtime from node_modules into public/pyodide so the app
// is fully self-hosted (no CDN dependency at runtime).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join('node_modules', 'pyodide');
const dest = join('public', 'pyodide');
if (!existsSync(src)) {
  console.warn('[copy-pyodide] node_modules/pyodide not found, skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of ['pyodide.asm.js', 'pyodide.asm.wasm', 'pyodide.mjs', 'pyodide.js', 'python_stdlib.zip', 'pyodide-lock.json']) {
  if (existsSync(join(src, f))) cpSync(join(src, f), join(dest, f));
}
console.log('[copy-pyodide] copied runtime to', dest);
