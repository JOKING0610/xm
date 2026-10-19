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
    proxy: {
      // yunzhiapi 无 CORS 放行（OPTIONS 预检 404、POST 无 ACAO 头），浏览器直连被拦截。
      // dev 下把 /yunzhi-api/* 经 Vite 服务器转发到 https://yunzhiapi.cn/*，绕开同源限制。
      // 注意：仅 `npm run dev` 生效；生产静态部署无此代理，gemini 系模型需自建反代才可直连。
      '/yunzhi-api': {
        target: 'https://yunzhiapi.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yunzhi-api/, ''),
      },
    },
  },
  optimizeDeps: {
    include: ['shiki', '@shikijs/engine-javascript'],
  },
});