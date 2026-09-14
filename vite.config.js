import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'frontend/index.html')
    }
  },
  plugins: [
    {
      name: 'copy-renderer-assets',
      writeBundle() {
        const dirsToCopy = ['js', 'css'];
        dirsToCopy.forEach((dir) => {
          const src = path.resolve(__dirname, 'frontend', dir);
          const dest = path.resolve(__dirname, 'dist/renderer', dir);
          if (fs.existsSync(src)) {
            fs.mkdirSync(dest, { recursive: true });
            fs.cpSync(src, dest, { recursive: true });
          }
        });
      }
    }
  ]
});
