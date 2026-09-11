import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { apiRouter } from "./router";

/**
 * 网页端入口：提供 /api/* 能力接口，并托管前端构建产物（out/web）。
 * 一套 UI 同时服务桌面端（Electron 壳）与网页端（本服务）。
 */

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use("/api", apiRouter);

// 静态资源 + SPA 回退（/api 之外的 GET 全部返回 index.html）
const webDir = path.join(process.cwd(), "out", "web");
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(webDir, "index.html"));
  });
}

// 统一错误处理
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "服务器内部错误";
  res.status(500).json({ error: message });
});

// 端口：SERVER_PORT 优先，兼容托管平台常用的 PORT，默认 8787
const port = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`[deekai-server] 运行中: http://localhost:${port}`);
});
