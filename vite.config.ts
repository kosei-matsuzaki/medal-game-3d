import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
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
