import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { PublicConfig, WritableConfig } from "@shared/bridge-api";
import type { StoreMode } from "@shared/chat-types";

/**
 * 配置管理器（主进程单例）：
 * - 配置来源合并顺序：.env 文件（环境基准）< 应用数据目录 config.json（设置页写入，优先级最高）
 * - 启动时注入的 process.env 同名键会覆盖 .env 文件基准
 * - DeepSeek Key / service_role 等敏感值只留在主进程，绝不发给渲染进程
 */

const ALLOWED_KEYS = [
  "DATA_STORE",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
] as const;

export type RawConfig = Partial<Record<(typeof ALLOWED_KEYS)[number], string>>;

class ConfigManager {
  /** 基准层：环境变量 + .env 文件 */
  private base: RawConfig = {};
  /** 覆盖层：设置页写入 config.json */
  private userConfig: RawConfig = {};
  private loaded = false;
  private source = "默认（无配置文件）";

  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    // 1) .env 文件（应用根目录 / resources）
    const envCandidates = [
      path.join(app.getAppPath(), ".env"),
      path.join(app.getAppPath(), "resources", ".env"),
      path.join(process.cwd(), ".env"),
    ];
    let fromFile: RawConfig = {};
    for (const candidate of envCandidates) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const parsed = dotenv.parse(fs.readFileSync(candidate, "utf-8"));
        const picked: RawConfig = {};
        for (const key of ALLOWED_KEYS) {
          const value = parsed[key];
          if (typeof value === "string" && value.trim()) {
            picked[key] = value.trim();
          }
        }
        fromFile = picked;
        this.source = "文件 .env";
        break;
      } catch {
        // 忽略无法读取的 .env
      }
    }

    // 2) 启动环境变量覆盖 .env 文件（同一键以环境变量为准）
    for (const key of ALLOWED_KEYS) {
      const value = process.env[key];
      if (typeof value === "string" && value.trim()) {
        fromFile[key] = value.trim();
      }
    }
    this.base = fromFile;

    // 3) 应用数据目录 config.json（设置页保存的覆盖项，优先级最高）
    this.userConfig = this.readUserConfig();
    this.refreshSourceLabel();
  }

  private readUserConfig(): RawConfig {
    try {
      const file = this.userConfigPath();
      if (!fs.existsSync(file)) return {};
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as RawConfig;
      const picked: RawConfig = {};
      for (const key of ALLOWED_KEYS) {
        if (typeof parsed[key] === "string" && parsed[key]!.trim()) {
          picked[key] = parsed[key]!.trim();
        }
      }
      return picked;
    } catch {
      return {};
    }
  }

  private refreshSourceLabel(): void {
    const labels: string[] = [];
    if (Object.keys(this.base).length > 0) labels.push("文件 .env");
    if (Object.keys(this.userConfig).length > 0) labels.push("应用设置 config.json");
    this.source = labels.length > 0 ? labels.join(" + ") : "默认（无配置文件）";
  }

  private userConfigPath(): string {
    return path.join(app.getPath("userData"), "config.json");
  }

  /** 读取主进程内部使用的配置值（含敏感项，仅主进程可用） */
  get(key: (typeof ALLOWED_KEYS)[number]): string | null {
    return this.userConfig[key] ?? this.base[key] ?? null;
  }

  private computeStore(): StoreMode {
    const store = this.get("DATA_STORE");
    const url = this.get("SUPABASE_URL");
    const anon = this.get("SUPABASE_ANON_KEY");

    if (store === "memory") return "memory";
    // 未显式声明时：Supabase 配置齐全就按 supabase，否则退化为内存
    if (store === "supabase" || !store) {
      return url && anon ? "supabase" : "memory";
    }
    return "memory";
  }

  /**
   * 保存设置页提交的字段（只允许白名单键）。
   * 语义：字符串为空 -> 清除该键；非空 -> 覆盖。最终写入 config.json。
   */
  save(values: WritableConfig): void {
    const next: RawConfig = { ...this.readUserConfig() };
    for (const key of ALLOWED_KEYS) {
      const value = values[key];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          next[key] = trimmed;
        } else {
          delete next[key];
        }
      }
    }

    this.userConfig = next;
    this.refreshSourceLabel();

    try {
      fs.mkdirSync(path.dirname(this.userConfigPath()), { recursive: true });
      fs.writeFileSync(
        this.userConfigPath(),
        JSON.stringify(next, null, 2),
        "utf-8"
      );
    } catch (err) {
      throw new Error(`写入配置文件失败: ${(err as Error).message}`);
    }
  }

  /** 渲染进程可见的公开视图（剔除敏感值） */
  publicConfig(): PublicConfig {
    const store = this.computeStore();
    const url = this.get("SUPABASE_URL");
    const anon = this.get("SUPABASE_ANON_KEY");
    const supabaseConfigured = store === "supabase" && Boolean(url && anon);

    return {
      store,
      supabaseConfigured,
      supabaseUrl: url,
      // anon key 本身是公开的（等同网页端公开下发），渲染进程用它直连 Supabase
      supabaseAnonKey: supabaseConfigured ? anon : null,
      deepseekConfigured: Boolean(this.get("DEEPSEEK_API_KEY")),
      model: this.get("DEEPSEEK_MODEL"),
      configSource: this.source,
      appVersion: app.getVersion(),
      userDataDir: app.getPath("userData"),
    };
  }
}

export const configManager = new ConfigManager();
