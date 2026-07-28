import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    // eecircuit-engine (Ngspice WASM) runs as an ES-module worker
    format: 'es',
  },
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the Fastify backend during development
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['eecircuit-engine'],
  },
});
