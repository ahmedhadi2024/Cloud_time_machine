import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately; in production both are served
    // from the same origin behind CloudFront, so the base path stays /api.
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:8080', changeOrigin: true },
      '/events': { target: process.env.API_URL ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // React Flow and Recharts are both large and change rarely, so they
        // are split out to keep the app chunk small and cacheable.
        manualChunks: {
          react: ['react', 'react-dom'],
          flow: ['reactflow'],
          charts: ['recharts'],
        },
      },
    },
  },
});
