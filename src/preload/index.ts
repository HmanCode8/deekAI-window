import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatStreamEvent,
  DeekaiBridge,
  DesktopDeeplink,
} from "@shared/bridge-api";

/**
 * preload：通过 contextBridge 向渲染进程暴露受控 API（window.deekai）。
 * 流式事件与协议唤起事件经 ipcRenderer.on 转发给注册的回调（单一订阅者模型）。
 */
let chatListener: ((event: ChatStreamEvent) => void) | null = null;
let deeplinkListener: ((link: DesktopDeeplink) => void) | null = null;

ipcRenderer.on("deekai:chat", (_event, payload: ChatStreamEvent) => {
  chatListener?.(payload);
});

ipcRenderer.on("deekai:deeplink", (_event, payload: DesktopDeeplink) => {
  deeplinkListener?.(payload);
});

const bridge: DeekaiBridge = {
  kind: "desktop",
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (values) => ipcRenderer.invoke("config:save", values),
  chatStart: (payload) => ipcRenderer.invoke("chat:start", payload),
  chatAbort: (id) => {
    ipcRenderer.send("chat:abort", id);
  },
  onChatEvent: (cb) => {
    chatListener = cb;
    return () => {
      if (chatListener === cb) chatListener = null;
    };
  },
  uploadFile: (input) => ipcRenderer.invoke("upload:file", input),
  listModels: (input) => ipcRenderer.invoke("models:list", input),
  adoptOrphans: (token, userId) =>
    ipcRenderer.invoke("supabase:adopt", { token, userId }),
  openExternal: (url) => {
    ipcRenderer.send("shell:open", url);
  },
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard:write", text),
  // 已处于桌面端，无需再唤起；聚焦自身即可
  openDesktop: () => {
    ipcRenderer.send("window:focus");
  },
  onDeeplink: (cb) => {
    deeplinkListener = cb;
    return () => {
      if (deeplinkListener === cb) deeplinkListener = null;
    };
  },
  getPendingDeeplink: () => ipcRenderer.invoke("deeplink:consume"),
  exportPdf: (input) => ipcRenderer.invoke("export:pdf", input),
};

contextBridge.exposeInMainWorld("deekai", bridge);
