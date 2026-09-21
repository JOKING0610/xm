import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base: './' 使构建产物可部署到 GitHub Pages 的子路径（如 /<repo>/）
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    include: ['shiki', '@shikijs/engine-javascript'],
  },
});