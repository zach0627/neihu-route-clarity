import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build --mode pages` is the GitHub Pages build: it fetches the live.json produced by the scheduled workflow.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  define: { __LIVE_MODE__: JSON.stringify(mode === 'pages') },
  envPrefix: 'PUBLIC_',
  build: {
    target: 'es2020',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 10000000,
    sourcemap: false,
    rollupOptions: {
      output: { format: 'iife' },
    },
  },
}));
