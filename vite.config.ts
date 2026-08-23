import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    // 5173 AND 5174 are both taken on this machine by the keiba-ai frontend
    // (its vite auto-incremented off 5173), so this project sits on 5175.
    // strictPort matters here: without it vite silently drifts to the next free
    // port, and you end up staring at whichever app got there first.
    port: 5175,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  optimizeDeps: {
    // rapier3d-compat ships inline wasm (base64) so no special handling needed,
    // but pre-bundling it speeds up dev startup.
    include: ['@dimforge/rapier3d-compat'],
  },
});
