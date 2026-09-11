import {
  DESKTOP_PROTOCOL,
  type ChatStreamEvent,
  type DeekaiBridge,
} from "@shared/bridge-api";
import type { ChatStartPayload, PublicConfig, WritableConfig } from "@shared/bridge-api";
import { getSupabase } from "../supabase";

/**
 * 网页端适配器：把「能力后端」的 HTTP 契约实现成与桌面端 IPC 相同的接口。
 * 契约（见 src/server/router.ts，将来可由 Java 后端实现同一套）：
 *   GET  /api/config        -> PublicConfig
 *   PUT  /api/config        -> { ok: true }
 *   POST /api/chat          -> text/event-stream，data 为 ChatStreamEvent JSON（需 Bearer token）
 *   POST /api/upload        -> UploadedAttachment（multipart，字段名 file + target；需 Bearer token）
 *   POST /api/models        -> { models, error? }
 *   POST /api/auth/adopt    -> { adopted: boolean }
 */

const controllers = new Map<string, AbortController>();
let chatListener: ((event: ChatStreamEvent) => void) | null = null;

function emit(event: ChatStreamEvent): void {
  chatListener?.(event);
}

/**
 * 附带当前登录用户的 access token（需要鉴权的端点用）。
 * 未初始化 Supabase 或未登录时返回空对象——服务端会据此返回 401。
 */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function readError(response: Response, fallback: string): Promise<Error> {
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return new Error(data?.error || `${fallback} (${response.status})`);
}

async function chatStart(payload: ChatStartPayload): Promise<void> {
  const controller = new AbortController();
  controllers.set(payload.id, controller);

  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    controllers.delete(payload.id);
    if ((err as Error).name === "AbortError") {
      emit({ id: payload.id, type: "stopped" });
      return;
    }
    throw err;
  }

  if (!response.ok || !response.body) {
    controllers.delete(payload.id);
    throw await readError(response, "对话请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const dataLine = block
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const raw = dataLine.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          emit(JSON.parse(raw) as ChatStreamEvent);
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      emit({ id: payload.id, type: "stopped" });
    } else {
      emit({ id: payload.id, type: "error", message: (err as Error).message });
    }
  } finally {
    controllers.delete(payload.id);
  }
}

export const httpBridge: DeekaiBridge = {
  kind: "web",

  async getConfig(): Promise<PublicConfig> {
    const response = await fetch("/api/config");
    if (!response.ok) throw await readError(response, "读取配置失败");
    return (await response.json()) as PublicConfig;
  },

  async saveConfig(values: WritableConfig): Promise<{ ok: true }> {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!response.ok) throw await readError(response, "保存配置失败");
    return { ok: true };
  },

  chatStart,
  chatAbort(id) {
    controllers.get(id)?.abort();
  },
  onChatEvent(cb) {
    chatListener = cb;
    return () => {
      if (chatListener === cb) chatListener = null;
    };
  },

  async uploadFile(input) {
    const formData = new FormData();
    formData.append(
      "file",
      new File([input.bytes], input.name, {
        type: input.type || "application/octet-stream",
      })
    );
    if (input.target) formData.append("target", JSON.stringify(input.target));

    const response = await fetch("/api/upload", {
      method: "POST",
      headers: await authHeader(),
      body: formData,
    });
    if (!response.ok) throw await readError(response, "上传失败");
    return response.json();
  },

  async listModels(input) {
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const error = await readError(response, "获取模型列表失败");
      return { models: [], error: error.message };
    }
    return response.json();
  },

  async adoptOrphans(token, userId) {
    const response = await fetch("/api/auth/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, userId }),
    });
    if (!response.ok) return { adopted: false };
    return response.json();
  },

  openExternal(url) {
    if (/^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },

  async clipboardWrite(text) {
    await navigator.clipboard.writeText(text);
  },

  /** 网页端专用：通过自定义协议唤起本地已安装的桌面应用 */
  openDesktop({ conversationId, draft }) {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversation", conversationId);
    if (draft) params.set("draft", draft);
    const query = params.toString();
    window.location.href = `${DESKTOP_PROTOCOL}://open${query ? `?${query}` : ""}`;
  },

  onDeeplink() {
    // 网页端不接收协议事件
    return () => {};
  },

  async getPendingDeeplink() {
    return null;
  },

  /** 网页端：打开新窗口写入导出 HTML，由用户在弹出的打印对话框中选择“另存为 PDF” */
  async exportPdf({ html }) {
    const win = window.open("", "_blank");
    if (!win) return { saved: false };
    win.document.open();
    win.document.write(html);
    win.document.close();
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    win.focus();
    win.print();
    return { saved: true };
  },
};
