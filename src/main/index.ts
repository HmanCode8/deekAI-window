import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { configManager } from "./config";
import { abortAllStreams, registerIpcHandlers } from "./ipc";

// 开发/非打包运行：把用户数据目录放到项目内，避免写入系统目录被权限限制
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getAppPath(), ".dev-profile"));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    title: "DeekAI",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => {
    win.show();
  });

  // 外部链接一律交给系统浏览器，避免应用内跳转丢失状态
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    // electron-vite dev server
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  configManager.load();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  abortAllStreams();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
