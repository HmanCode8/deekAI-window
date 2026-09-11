import fs from "node:fs";
import path from "node:path";
import { ConfigCore, type BaseConfigFile } from "@shared/config-core";

/**
 * 网页端配置（服务端）：
 * - 基础设施配置由部署方提供：app-config.json（可选）与 .env（推荐）
 * - 用户层配置写入 server-data/config.json（仅模型等白名单键可覆盖）
 * - 版本默认 release（线上），本地开发可通过 DEEKAI_EDITION=advanced 打开完整设置
 * - 可通过 SERVER_DATA_DIR / SERVER_CONFIG_PATH 自定义目录
 */

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")
    ) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function readAppConfig(): BaseConfigFile {
  const file = path.join(process.cwd(), "app-config.json");
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf-8")) as BaseConfigFile;
  } catch {
    return {};
  }
}

const dataDir =
  process.env.SERVER_DATA_DIR ?? path.join(process.cwd(), "server-data");

export const serverConfig = new ConfigCore({
  configFilePath:
    process.env.SERVER_CONFIG_PATH ?? path.join(dataDir, "config.json"),
  envFiles: [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), ".env.local"),
  ],
  env: process.env,
  version: readVersion(),
  dataDir,
  baseConfig: readAppConfig(),
});

serverConfig.load();
