import { Router } from "express";
import multer from "multer";
import type { ChatMessage } from "@shared/attachments";
import type { ChatStreamEvent } from "@shared/bridge-api";
import { streamChat } from "../backend/deepseek";
import { handleUpload } from "../backend/uploads";
import { adoptOrphanRows } from "../backend/supabase-admin";
import { serverConfig } from "./config";

/**
 * ============ 网页端能力后端：HTTP 契约（可被任意语言实现，例如 Java） ============
 *
 * GET  /api/config          -> PublicConfig（公开配置，不含 DeepSeek Key / service_role）
 * PUT  /api/config          -> { ok: true }      请求体为 WritableConfig，空串表示清除该键
 * POST /api/chat            -> text/event-stream，每帧 `data: <ChatStreamEvent JSON>`
 *                              请求体 { id, messages, model }；客户端断开即中止上游请求
 * POST /api/upload          -> UploadedAttachment  multipart/form-data，字段名 file
 * POST /api/auth/adopt      -> { adopted: boolean }  请求体 { token, userId }
 *
 * 认证与业务数据（会话/项目）由前端直连 Supabase（anon key + 用户 token + RLS），
 * 后端只承担「需要密钥或 Node 能力」的三件事：模型调用、文件解析、老数据认领。
 */

export const apiRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
});

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

apiRouter.get("/config", (_req, res) => {
  res.json(serverConfig.publicConfig());
});

apiRouter.put("/config", (req, res) => {
  try {
    const values = (req.body ?? {}) as Record<string, string>;
    serverConfig.save(values);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.post("/chat", async (req, res) => {
  const body = (req.body ?? {}) as {
    id?: string;
    messages?: ChatMessage[];
    model?: string;
  };

  if (!body.id || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "缺少消息内容" });
    return;
  }

  const apiKey = serverConfig.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    res.status(500).json({ error: "未配置模型 API Key，请在设置或 .env 中配置" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const controller = new AbortController();
  const send = (event: ChatStreamEvent) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  // 客户端断开（用户点“停止”或关闭页面）即中止上游
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    await streamChat(
      {
        id: body.id,
        messages: body.messages,
        model: body.model,
        apiKey,
        baseUrl: serverConfig.get("DEEPSEEK_BASE_URL"),
        fallbackModel: serverConfig.get("DEEPSEEK_MODEL"),
        signal: controller.signal,
      },
      send
    );
  } finally {
    if (!res.writableEnded) res.end();
  }
});

apiRouter.post("/upload", upload.single("file"), async (req, res) => {
  const file = (req as unknown as { file?: UploadedFileLike }).file;
  if (!file) {
    res.status(400).json({ error: "缺少上传文件" });
    return;
  }

  try {
    const bytes = file.buffer.buffer.slice(
      file.buffer.byteOffset,
      file.buffer.byteOffset + file.buffer.byteLength
    ) as ArrayBuffer;

    const attachment = await handleUpload(
      {
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        bytes,
      },
      {
        apiKey: serverConfig.get("DEEPSEEK_API_KEY"),
        baseUrl: serverConfig.get("DEEPSEEK_BASE_URL"),
      }
    );

    res.json(attachment);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || "上传文件失败" });
  }
});

apiRouter.post("/auth/adopt", async (req, res) => {
  const { token, userId } = (req.body ?? {}) as {
    token?: string;
    userId?: string;
  };
  if (typeof token !== "string" || typeof userId !== "string") {
    res.json({ adopted: false });
    return;
  }

  const result = await adoptOrphanRows(token, userId, {
    url: serverConfig.get("SUPABASE_URL"),
    anonKey: serverConfig.get("SUPABASE_ANON_KEY"),
    serviceKey: serverConfig.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  res.json(result);
});
