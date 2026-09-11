import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { configManager } from "./config";
import {
  extractDeeplinkFromArgv,
  parseDeeplink,
  registerProtocolClient,
} from "./deeplink";
import { abortAllStreams, emitDeeplink, registerIpcHandlers } from "./ipc";

// 开发/非打包运行：把用户数据目录放到项目内，避免写入系统目录被权限限制
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getAppPath(), ".dev-profile"));
}

let mainWindow: BrowserWindow | null = null;

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
    icon: !app.isPackaged
      ? path.join(app.getAppPath(), "build", "icon.png")
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
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

// ---- 单实例锁 + 自定义协议（deekai://）----
// 协议唤起时系统会新起一个进程，这里把参数转发给已运行实例并聚焦窗口
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const link = extractDeeplinkFromArgv(argv);
  if (link) emitDeeplink(link);
  focusMainWindow();
});

// macOS 通过 open-url 唤起；Windows 走 second-instance / argv
app.on("open-url", (event, url) => {
  event.preventDefault();
  const link = parseDeeplink(url);
  if (link) {
    emitDeeplink(link);
    focusMainWindow();
  }
});

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    configManager.load();
    registerIpcHandlers();
    registerProtocolClient();
    createWindow();

    // Windows 首次通过协议启动：链接在启动参数里
    const initialLink = extractDeeplinkFromArgv(process.argv);
    if (initialLink) emitDeeplink(initialLink);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  abortAllStreams();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
