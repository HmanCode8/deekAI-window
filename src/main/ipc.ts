import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ChatStartPayload,
  ChatStreamEvent,
  DesktopDeeplink,
  ExportPdfInput,
} from "@shared/bridge-api";
import { sanitizeModelTarget, toResolvedModel } from "@shared/model-profiles";
import { configManager } from "./config";
import { streamChat } from "../backend/deepseek";
import { handleUpload } from "../backend/uploads";
import { listModels } from "../backend/models";
import { adoptOrphanRows } from "../backend/supabase-admin";

/**
 * 注册全部 IPC 通道。
 * 原则：DeepSeek API Key 与 Supabase service role 只在后端内使用；
 * 渲染进程仅持有公开配置（anon key 等同网页端公开值）。
 */

const activeStreams = new Map<string, AbortController>();

/** 启动/唤起时产生的协议参数，等待渲染进程消费（消费即清空，避免刷新后重复套用） */
let pendingDeeplink: DesktopDeeplink | null = null;

/** 广播协议唤起事件：窗口未就绪时先缓存 */
export function emitDeeplink(link: DesktopDeeplink): void {
  pendingDeeplink = link;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("deekai:deeplink", link);
    }
  }
}

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

    const profile = toResolvedModel(sanitizeModelTarget(payload.target), (id) =>
      configManager.resolveModel(id)
    );
    if (!profile.apiKey) {
      sendToWindow(win, {
        id: payload.id,
        type: "error",
        message: `「${profile.name}」未配置 API Key，请在设置 → 模型设置中填写`,
      });
      return;
    }

    const controller = new AbortController();
    activeStreams.set(payload.id, controller);

    try {
      await streamChat(
        {
          id: payload.id,
          messages: payload.messages,
          profile,
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
    const payload = input as Parameters<typeof handleUpload>[0];
    const profile = toResolvedModel(sanitizeModelTarget(payload.target), (id) =>
      configManager.resolveModel(id)
    );
    return handleUpload(payload, profile);
  });

  // 拉取模型服务可用模型列表：优先用表单里正在编辑的值，缺省回读已保存的条目
  ipcMain.handle("models:list", (_event, input: unknown) => {
    const { baseUrl, apiKey, profileId } = (input ?? {}) as {
      baseUrl?: string;
      apiKey?: string;
      profileId?: string;
    };

    if (baseUrl?.trim() && apiKey?.trim()) {
      return listModels({ baseUrl, apiKey });
    }

    const profile = configManager.resolveModel(profileId);
    return listModels({
      baseUrl: baseUrl?.trim() || profile.baseUrl,
      apiKey: apiKey?.trim() || profile.apiKey,
    });
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

  // 渲染进程挂载后消费启动时的协议参数（消费即清空）
  ipcMain.handle("deeplink:consume", () => {
    const link = pendingDeeplink;
    pendingDeeplink = null;
    return link;
  });

  ipcMain.on("shell:open", (_event, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });

  // 桌面端自身被“唤起”时聚焦窗口
  ipcMain.on("window:focus", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // 导出 PDF：保存对话框 -> 隐藏窗口渲染 HTML -> printToPDF 落盘
  ipcMain.handle("export:pdf", async (event, input: ExportPdfInput) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "导出会话为 PDF",
      defaultPath: input.fileName,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { saved: false };
    }

    const tempHtml = path.join(
      app.getPath("temp"),
      `deekai-export-${Date.now()}.html`
    );

    await fs.writeFile(tempHtml, input.html, "utf-8");

    const hidden = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });

    try {
      await hidden.loadFile(tempHtml);
      const pdf = await hidden.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
      });
      await fs.writeFile(result.filePath, pdf);
      return { saved: true, path: result.filePath };
    } finally {
      hidden.destroy();
      fs.unlink(tempHtml).catch(() => {});
    }
  });
}

export function abortAllStreams(): void {
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
}
