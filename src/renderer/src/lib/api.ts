import type { ChatMessage, UploadedAttachment } from "@shared/attachments";
import type { ChatState } from "@shared/chat-types";
import type {
  BridgeKind,
  DesktopDeeplink,
  ExportPdfInput,
  ExportPdfResult,
  PublicConfig,
  WritableConfig,
} from "@shared/bridge-api";
import { bridge } from "./bridge";
import { loadChatState as loadState, saveChatState as saveState } from "./persistence";
import { getSupabase } from "./supabase";

/**
 * 渲染进程 API 门面（一套 UI，双端复用）：
 * 底层由 lib/bridge 选择桌面 IPC 或网页 HTTP，UI 不感知运行形态。
 */

/** 当前运行形态：desktop(桌面端) / web(网页端) */
export const bridgeKind: BridgeKind = bridge.kind;

export function getConfig(): Promise<PublicConfig> {
  return bridge.getConfig();
}

export function saveConfig(values: WritableConfig): Promise<{ ok: true }> {
  return bridge.saveConfig(values);
}

/** 老数据认领（登录/注册成功后静默执行） */
export function adoptOrphans(token: string, userId: string): void {
  bridge.adoptOrphans(token, userId).catch(() => {});
}

export async function uploadFile(file: File): Promise<UploadedAttachment> {
  const bytes = await file.arrayBuffer();
  return bridge.uploadFile({
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

  const unsubscribe = bridge.onChatEvent((event) => {
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

  bridge.chatStart({ id, messages, model }).catch((err: unknown) => {
    unsubscribe();
    rejectPromise(err instanceof Error ? err : new Error(String(err)));
  });

  return {
    promise,
    abort: () => bridge.chatAbort(id),
  };
}

export async function loadChatState(): Promise<ChatState> {
  return loadState(getSupabase());
}

export async function saveChatState(state: ChatState): Promise<void> {
  await saveState(state, getSupabase());
}

export function openExternal(url: string): void {
  bridge.openExternal(url);
}

export async function clipboardWrite(text: string): Promise<void> {
  try {
    await bridge.clipboardWrite(text);
  } catch {
    // 忽略剪贴板失败
  }
}

/** 网页端：唤起本地桌面应用（携带当前会话与草稿）；桌面端：聚焦自身 */
export function openDesktop(payload: DesktopDeeplink): void {
  bridge.openDesktop(payload);
}

/** 桌面端：接收协议唤起事件（返回取消订阅函数） */
export function onDeeplink(cb: (link: DesktopDeeplink) => void): () => void {
  return bridge.onDeeplink(cb);
}

/** 桌面端：取出启动时缓存的协议参数（消费一次） */
export function getPendingDeeplink(): Promise<DesktopDeeplink | null> {
  return bridge.getPendingDeeplink();
}

/** 导出 PDF：桌面端保存到本地文件；网页端打开打印对话框 */
export function exportPdf(input: ExportPdfInput): Promise<ExportPdfResult> {
  return bridge.exportPdf(input);
}
