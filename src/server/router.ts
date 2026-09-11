import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import type { ChatMessage } from "@shared/attachments";
import type { ChatStreamEvent } from "@shared/bridge-api";
import { streamChat } from "../backend/deepseek";
import { handleUpload } from "../backend/uploads";
import { listModels } from "../backend/models";
import { adoptOrphanRows } from "../backend/supabase-admin";
import { verifyAccessToken } from "../backend/supabase-auth";
import {
  sanitizeModelTarget,
  toResolvedModel,
} from "@shared/model-profiles";
import { serverConfig } from "./config";

/**
 * ============ 网页端能力后端：HTTP 契约（可被任意语言实现，例如 Java） ============
 *
 * GET  /api/config          -> PublicConfig（公开配置，不含模型 Key / service_role）
 * PUT  /api/config          -> { ok: true }      请求体为 WritableConfig，空串表示清除该键
 *                              （只有 advanced 自托管版能写基础设施；模型条目一律不在服务端写）
 * POST /api/chat            -> text/event-stream，每帧 `data: <ChatStreamEvent JSON>`
 *                              请求体 { id, messages, target }；需 Authorization: Bearer <token>
 * POST /api/upload          -> UploadedAttachment  multipart/form-data，字段名 file + target(JSON 字符串)
 *                              需 Authorization: Bearer <token>
 * POST /api/models          -> { models, error? }  请求体 { baseUrl?, apiKey?, profileId? }
 * POST /api/auth/adopt      -> { adopted: boolean }  请求体 { token, userId }
 *
 * 鉴权：配置了 Supabase 的部署，/api/chat 与 /api/upload 必须带有效的用户 access token
 * （服务端拿 anon key 去 Supabase 校验，见 backend/supabase-auth.ts），
 * 过期/伪造返回 401；未配置 Supabase（纯内存模式）时不启用鉴权。
 * /api/config 与 /api/models 保持开放：前者只返回公开值，后者需要调用方自带 baseUrl + key。
 *
 * target 形如：
 *   { kind: "profile", profileId }                        用服务端预置条目（Key 在服务端）
 *   { kind: "inline", baseUrl, model, apiKey, name? }     用调用方本机/浏览器的条目（Key 不落盘）
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

/** 取出 Authorization: Bearer <token> 里的 token */
function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * 需要登录的接口前置校验：不通过时已写好 401 响应，调用方直接 return。
 * 未配置 Supabase 时放行（纯内存模式没有账号体系）。
 */
async function requireAuth(req: Request, res: Response): Promise<boolean> {
  const url = serverConfig.get("SUPABASE_URL");
  const anonKey = serverConfig.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return true;

  const token = bearerToken(req);
  const user = token ? await verifyAccessToken(token, { url, anonKey }) : null;
  if (!user) {
    res.status(401).json({ error: "登录已过期或未登录，请重新登录" });
    return false;
  }
  return true;
}

/** multipart 里的 target 是 JSON 字符串，容错解析 */
function parseTargetField(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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
    target?: unknown;
  };

  if (!body.id || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "缺少消息内容" });
    return;
  }

  if (!(await requireAuth(req, res))) return;

  const profile = toResolvedModel(sanitizeModelTarget(body.target), (id) =>
    serverConfig.resolveModel(id)
  );
  if (!profile.apiKey) {
    res
      .status(500)
      .json({ error: `「${profile.name}」未配置 API Key，请在设置 → 模型设置中填写` });
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
        profile,
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

  if (!(await requireAuth(req, res))) return;

  try {
    const bytes = file.buffer.buffer.slice(
      file.buffer.byteOffset,
      file.buffer.byteOffset + file.buffer.byteLength
    ) as ArrayBuffer;

    const target = sanitizeModelTarget(parseTargetField(req.body?.target));

    const attachment = await handleUpload(
      {
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        bytes,
        target,
      },
      toResolvedModel(target, (id) => serverConfig.resolveModel(id))
    );

    res.json(attachment);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || "上传文件失败" });
  }
});

// 拉取模型服务可用模型列表（供设置面板选择）
apiRouter.post("/models", async (req, res) => {
  const { baseUrl, apiKey, profileId } = (req.body ?? {}) as {
    baseUrl?: string;
    apiKey?: string;
    profileId?: string;
  };

  if (baseUrl?.trim() && apiKey?.trim()) {
    res.json(await listModels({ baseUrl, apiKey }));
    return;
  }

  const profile = serverConfig.resolveModel(profileId);
  res.json(
    await listModels({
      baseUrl: baseUrl?.trim() || profile.baseUrl,
      apiKey: apiKey?.trim() || profile.apiKey,
    })
  );
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
