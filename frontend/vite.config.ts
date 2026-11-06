import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: false,
  server: { host: '127.0.0.1', port: 5174, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8080' }, '/healthz': { target: 'http://127.0.0.1:8080' } } },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
