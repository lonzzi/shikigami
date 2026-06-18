import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // 使用编程式路由（src/routes.tsx），不启用 TanStack 文件路由插件
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // 生产构建产物拷贝到 backend/public 由后端托管
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 拆分 vendor: react 核心 / 路由 / radix 各自独立 chunk，
        // 浏览器并行下载 + 长期缓存（应用代码变更不致 vendor 失效）。
        // 用函数形式按 id 前缀匹配，更稳健（覆盖 react/jsx-runtime 等子路径）。
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'react-vendor';
            if (id.includes('/@tanstack/')) return 'router-vendor';
            if (id.includes('/@radix-ui/')) return 'radix-vendor';
            if (id.includes('/lucide-react/')) return 'icon-vendor';
          }
        },
      },
    },
  },
});
