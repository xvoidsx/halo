import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Halo renderer: plain React + Vite. The shell is intentionally small —
// Ember's pattern (Vite renderer + Electron main, separate tsconfigs)
// without Ember's workspaces, harness binary, or branding.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  server: { port: 5173, host: '127.0.0.1' },
});
