import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  ConfigCore,
  type BaseConfigFile,
  type ConfigKey,
} from "@shared/config-core";
import type { PublicConfig, WritableConfig } from "@shared/bridge-api";

/**
 * 桌面端配置管理器（薄封装）：
 * 合并/校验/公开视图等纯逻辑复用 @shared/config-core，
 * 这里只负责提供 Electron 的路径与发行内置配置（app-config.json）。
 *
 * 发行内置配置的读取位置（按顺序）：
 *   1) 安装包 resources/app-config.json（打包时由 extraResources 放入）
 *   2) 应用目录 app-config.json（开发时即项目根目录）
 *   3) 当前工作目录 app-config.json
 */
function readAppConfig(): BaseConfigFile {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, "app-config.json")
      : "",
    path.join(app.getAppPath(), "app-config.json"),
    path.join(process.cwd(), "app-config.json"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return JSON.parse(fs.readFileSync(file, "utf-8")) as BaseConfigFile;
    } catch {
      // 忽略无法解析的发行配置
    }
  }
  return {};
}

class DesktopConfigManager {
  private readonly core = new ConfigCore({
    configFilePath: path.join(app.getPath("userData"), "config.json"),
    envFiles: [
      path.join(app.getAppPath(), ".env"),
      path.join(app.getAppPath(), "resources", ".env"),
      path.join(process.cwd(), ".env"),
    ],
    env: process.env,
    version: app.getVersion(),
    dataDir: app.getPath("userData"),
    baseConfig: readAppConfig(),
  });

  load(): void {
    this.core.load();
  }

  get(key: ConfigKey): string | null {
    return this.core.get(key);
  }

  save(values: WritableConfig): void {
    this.core.save(values);
  }

  publicConfig(): PublicConfig {
    return this.core.publicConfig();
  }
}

export const configManager = new DesktopConfigManager();
