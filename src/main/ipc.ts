import { BrowserWindow, clipboard, ipcMain, shell } from "electron";
import type { ChatStartPayload, ChatStreamEvent } from "@shared/bridge-api";
import { configManager } from "./config";
import { streamChat } from "./deepseek";
import { handleUpload } from "./uploads";
import { adoptOrphanRows } from "./supabase-admin";

/**
 * 注册全部 IPC 通道。
 * 原则：DeepSeek API Key 与 Supabase service role 只在主进程内使用；
 * 渲染进程仅持有公开配置（anon key 等同网页端公开值）。
 */

const activeStreams = new Map<string, AbortController>();

function sendToWindow(win: BrowserWindow, event: ChatStreamEvent) {
  if (!win.isDestroyed()) {
    win.webContents.send("deekai:chat", event);
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle("config:get", () => configManager.publicConfig());

  ipcMain.handle("config:save", (_event, values: unknown) => {
    if (typeof values !== "object" || values === null) {
      throw new Error("无效的配置数据");
    }
    configManager.save(values as Parameters<typeof configManager.save>[0]);
    return { ok: true as const };
  });

  ipcMain.handle("chat:start", async (event, payload: ChatStartPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !payload?.id) return;

    const apiKey = configManager.get("DEEPSEEK_API_KEY");
    if (!apiKey) {
      sendToWindow(win, {
        id: payload.id,
        type: "error",
        message: "未配置 DEEPSEEK_API_KEY，请先在设置中填写",
      });
      return;
    }

    const controller = new AbortController();
    activeStreams.set(payload.id, controller);

    const fallbackModel = configManager.get("DEEPSEEK_MODEL");

    try {
      await streamChat(
        {
          id: payload.id,
          messages: payload.messages,
          model: typeof payload.model === "string" ? payload.model : undefined,
          apiKey,
          fallbackModel,
          signal: controller.signal,
        },
        (eventPayload) => sendToWindow(win, eventPayload)
      );
    } catch (err) {
      if (!win.isDestroyed()) {
        sendToWindow(win, {
          id: payload.id,
          type: "error",
          message: (err as Error).message || "对话请求失败",
        });
      }
    } finally {
      activeStreams.delete(payload.id);
    }
  });

  ipcMain.on("chat:abort", (_event, id: unknown) => {
    if (typeof id === "string") {
      activeStreams.get(id)?.abort();
    }
  });

  ipcMain.handle("upload:file", (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("bytes" in input) ||
      !(input as { bytes: unknown }).bytes
    ) {
      throw new Error("缺少上传文件内容");
    }
    return handleUpload(
      input as Parameters<typeof handleUpload>[0],
      configManager.get("DEEPSEEK_API_KEY")
    );
  });

  ipcMain.handle("supabase:adopt", (_event, args: unknown) => {
    const { token, userId } = (args ?? {}) as { token?: string; userId?: string };
    if (typeof token !== "string" || typeof userId !== "string") {
      return { adopted: false };
    }
    return adoptOrphanRows(token, userId, {
      url: configManager.get("SUPABASE_URL"),
      anonKey: configManager.get("SUPABASE_ANON_KEY"),
      serviceKey: configManager.get("SUPABASE_SERVICE_ROLE_KEY"),
    });
  });

  ipcMain.handle("clipboard:write", (_event, text: unknown) => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  ipcMain.on("shell:open", (_event, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });
}

export function abortAllStreams(): void {
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
}
