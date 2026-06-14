import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      // Forward API + auth + payment routes to the Express backend so the SPA
      // and API share an origin in dev (cookies/sessions just work).
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
