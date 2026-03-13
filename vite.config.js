import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '/Users/nagybertalan/Local Sites/canvaswp/app/public/wp-content/plugins/framebuilder/assets',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'builder.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'builder.css';
          return '[name][extname]';
        },
      },
    },
  },
  server: {
    port: 3000,
    cors: true,
  },
});
