import { app } from "electron";
import path from "node:path";
import {
  DESKTOP_PROTOCOL,
  DEEPLINK_MAX_DRAFT,
  type DesktopDeeplink,
} from "@shared/bridge-api";

/**
 * 自定义协议（deekai://）注册与解析：
 * 网页端点击“在桌面端打开” => deekai://open?conversation=<id>&draft=<text>
 * Windows 通过注册表 HKCU\Software\Classes\deekai 关联到本应用。
 */

export function registerProtocolClient(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // 开发模式：electron.exe <主进程入口>
    app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL);
  }
}

export function parseDeeplink(url: string): DesktopDeeplink | null {
  if (typeof url !== "string" || !url.startsWith(`${DESKTOP_PROTOCOL}://`)) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const conversationId =
      parsed.searchParams.get("conversation") ??
      parsed.searchParams.get("conversationId");
    const rawDraft = parsed.searchParams.get("draft");
    return {
      conversationId: conversationId || null,
      draft: rawDraft ? rawDraft.slice(0, DEEPLINK_MAX_DRAFT) : null,
    };
  } catch {
    return null;
  }
}

/** 从进程参数中提取协议链接（Windows 首次通过协议启动时在 argv 里） */
export function extractDeeplinkFromArgv(
  argv: string[]
): DesktopDeeplink | null {
  const candidate = argv.find((arg) =>
    arg.startsWith(`${DESKTOP_PROTOCOL}://`)
  );
  return candidate ? parseDeeplink(candidate) : null;
}
