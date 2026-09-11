import type { DeekaiBridge } from "@shared/bridge-api";

/**
 * 桌面端适配器：直接使用 preload 暴露的 window.deekai（Electron IPC）。
 * 浏览器环境下返回 null，由 index.ts 回退到 HTTP 适配器。
 */
export function getElectronBridge(): DeekaiBridge | null {
  if (typeof window === "undefined") return null;
  return window.deekai ?? null;
}
