import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatStreamEvent,
  DeekaiBridge,
} from "@shared/bridge-api";

/**
 * preload：通过 contextBridge 向渲染进程暴露受控 API（window.deekai）。
 * 流式事件经 ipcRenderer.on 转发给注册的回调，保持单一订阅者模型。
 */
let chatListener: ((event: ChatStreamEvent) => void) | null = null;

ipcRenderer.on("deekai:chat", (_event, payload: ChatStreamEvent) => {
  chatListener?.(payload);
});

const bridge: DeekaiBridge = {
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
  adoptOrphans: (token, userId) =>
    ipcRenderer.invoke("supabase:adopt", { token, userId }),
  openExternal: (url) => {
    ipcRenderer.send("shell:open", url);
  },
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard:write", text),
};

contextBridge.exposeInMainWorld("deekai", bridge);
