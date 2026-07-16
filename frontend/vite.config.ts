import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      // Forward API + auth + payment routes to the Express backend so the SPA
      // and API share an origin in dev (cookies/sessions just work). ws:true
      // also forwards WebSocket upgrades (e.g. the terminal feature's
      // /api/portal/terminal/ws) — without it Vite silently drops upgrade
      // requests instead of proxying them, which looks like a hung connection.
      '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
