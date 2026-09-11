import type { DeekaiBridge } from "@shared/bridge-api";
import { getElectronBridge } from "./electron";
import { httpBridge } from "./http";

/**
 * 桥接适配器选择（一套 UI，双端运行）：
 * - 检测到 window.deekai（Electron preload）=> 桌面端 IPC
 * - 否则 => 网页端 HTTP（fetch /api/*，SSE 流式）
 */
export const bridge: DeekaiBridge = getElectronBridge() ?? httpBridge;
