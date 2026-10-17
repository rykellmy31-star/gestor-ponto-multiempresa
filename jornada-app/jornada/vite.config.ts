import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web', plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true, sourcemap: false },
  server: { allowedHosts: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
