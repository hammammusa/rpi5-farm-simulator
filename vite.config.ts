import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation is required for SharedArrayBuffer, which the Python
// runtime uses for blocking sleep(), synchronous GPIO reads and Stop.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
