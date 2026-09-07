import type { ChatMessage, UploadedAttachment } from "@shared/attachments";
import type { ChatState } from "@shared/chat-types";
import type { PublicConfig, WritableConfig } from "@shared/bridge-api";
import { loadChatState as loadState, saveChatState as saveState } from "./persistence";
import { getSupabase } from "./supabase";

/**
 * 渲染进程 API 层：把主进程能力封装成与网页版调用一致的接口，
 * 上层 UI（Chat/Login）不感知 Electron IPC 细节。
 */

export function getConfig(): Promise<PublicConfig> {
  return window.deekai.getConfig();
}

export function saveConfig(values: WritableConfig): Promise<{ ok: true }> {
  return window.deekai.saveConfig(values);
}

/** 老数据认领（登录/注册成功后静默执行） */
export function adoptOrphans(token: string, userId: string): void {
  window.deekai.adoptOrphans(token, userId).catch(() => {});
}

export async function uploadFile(file: File): Promise<UploadedAttachment> {
  const bytes = await file.arrayBuffer();
  return window.deekai.uploadFile({
    name: file.name,
    type: file.type,
    size: file.size,
    bytes,
  });
}

export interface StreamHandle {
  promise: Promise<void>;
  abort(): void;
}

/**
 * 发起一次流式对话。
 * - delta 逐段回调
 * - promise 在 done 时 resolve；stopped 时以 AbortError 拒绝；出错以普通 Error 拒绝
 */
export function streamChat(
  messages: ChatMessage[],
  model: string,
  onDelta: (text: string) => void
): StreamHandle {
  const id = crypto.randomUUID();

  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const unsubscribe = window.deekai.onChatEvent((event) => {
    if (event.id !== id) return;
    switch (event.type) {
      case "delta":
        onDelta(event.text);
        break;
      case "done":
        unsubscribe();
        resolvePromise();
        break;
      case "stopped": {
        unsubscribe();
        const error = new Error("已停止");
        error.name = "AbortError";
        rejectPromise(error);
        break;
      }
      case "error":
        unsubscribe();
        rejectPromise(new Error(event.message));
        break;
    }
  });

  window.deekai.chatStart({ id, messages, model }).catch((err: unknown) => {
    unsubscribe();
    rejectPromise(err instanceof Error ? err : new Error(String(err)));
  });

  return {
    promise,
    abort: () => window.deekai.chatAbort(id),
  };
}

export async function loadChatState(): Promise<ChatState> {
  return loadState(getSupabase());
}

export async function saveChatState(state: ChatState): Promise<void> {
  await saveState(state, getSupabase());
}

export function openExternal(url: string): void {
  window.deekai.openExternal(url);
}

export async function clipboardWrite(text: string): Promise<void> {
  try {
    await window.deekai.clipboardWrite(text);
  } catch {
    // 忽略剪贴板失败
  }
}
