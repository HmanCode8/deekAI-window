import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * 网页端前端构建（与 electron-vite 的 renderer 共用同一份源码）。
 * - dev：`npm run dev:web`，并把 /api 代理到本地能力服务（默认 8787）
 * - build：产物输出到 out/web，由 src/server 托管
 */
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@": resolve(__dirname, "src/renderer/src"),
    },
  },
  server: {
    port: 5174,
    // 端口被占用时直接报错，不要静默换端口：
    // localStorage 按 origin 隔离，端口一变（5174→5175）用户在本机配的模型条目就"消失"了
    strictPort: true,
    proxy: {
      "/api": {
        // 与 src/server/index.ts 保持一致：SERVER_PORT 优先，其次 PORT
        target: `http://localhost:${
          process.env.SERVER_PORT ?? process.env.PORT ?? 8787
        }`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, "out/web"),
    emptyOutDir: true,
  },
});
