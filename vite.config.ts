import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static, keyless app: no proxy, no env injection, no backend. Before any `vite` dev server is started, claim a host port
// through the agent-ports skill and pass it with `--port <claimed> --strictPort` (docs/DEFERRED-VALIDATION.md).
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
