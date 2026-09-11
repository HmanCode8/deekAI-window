import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { Edition, PublicConfig, WritableConfig } from "./bridge-api";
import type { StoreMode } from "./chat-types";

/**
 * 配置核心（两端共享的纯逻辑，不依赖 Electron / Express）。
 *
 * 两类配置，权限不同：
 * - 基础设施键 INFRA_KEYS：由运营方提供（发行内置 app-config.json / 部署 .env / 启动环境变量），
 *   release 版对普通用户不可见、不可改；advanced 版（自托管）才允许覆盖。
 * - 模型键 MODEL_KEYS：使用者可覆盖（BYOK，自带 Base URL + Key + 模型名）。
 *
 * 取值优先级：
 *   基础设施：发行内置配置 > 部署环境变量；用户配置永不参与
 *   模型：用户配置 > 发行内置配置 > 部署环境变量
 *
 * 版本（edition）判定优先级：
 *   启动环境变量 DEEKAI_EDITION > .env 文件 DEEKAI_EDITION > 发行内置 app-config.json，默认 release
 */

/** 基础设施键（运营方） */
export const INFRA_KEYS = [
  "DATA_STORE",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PUBLIC_WEB_URL",
] as const;

/** 模型键（使用者可覆盖，BYOK） */
export const MODEL_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
] as const;

export const ALL_CONFIG_KEYS = [...INFRA_KEYS, ...MODEL_KEYS] as const;

export type ConfigKey = (typeof ALL_CONFIG_KEYS)[number];
export type RawConfig = Partial<Record<ConfigKey, string>>;

/** 发行内置配置文件（app-config.json）的内容：配置键 + 版本标记 */
export interface BaseConfigFile extends RawConfig {
  DEEKAI_EDITION?: string;
}

export interface ConfigCoreOptions {
  /** 可写的用户配置文件（设置页保存到这里） */
  configFilePath: string;
  /** 只读的 .env 候选文件，按顺序取第一个存在的 */
  envFiles?: string[];
  env?: Record<string, string | undefined>;
  version: string;
  /** 展示用的数据目录（桌面端 userData / 服务端 server-data） */
  dataDir: string;
  /** 发行内置配置（运营方）：由 main / server 读取 app-config.json 后传入 */
  baseConfig?: BaseConfigFile;
}

export function parseConfigObject(source: unknown): RawConfig {
  const parsed = (source ?? {}) as Record<string, unknown>;
  const picked: RawConfig = {};
  for (const key of ALL_CONFIG_KEYS) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      picked[key] = value.trim();
    }
  }
  return picked;
}

export class ConfigCore {
  /** 部署环境层：.env 文件 + 启动环境变量 */
  private base: RawConfig = {};
  /** 发行内置层：运营方随包下发的 app-config.json */
  private published: RawConfig = {};
  /** 用户层：设置页保存的 config.json */
  private override: RawConfig = {};
  private edition: Edition = "release";
  private loaded = false;
  private source = "默认（无配置文件）";

  constructor(private readonly options: ConfigCoreOptions) {}

  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    // 0) 发行内置配置
    const baseConfig = this.options.baseConfig ?? {};
    this.published = parseConfigObject(baseConfig);

    // 1) .env 文件（第一个存在的作为基准）
    let fromFile: RawConfig = {};
    let editionFromFile: string | undefined;
    for (const candidate of this.options.envFiles ?? []) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const parsed = dotenv.parse(fs.readFileSync(candidate, "utf-8"));
        fromFile = parseConfigObject(parsed);
        // DEEKAI_EDITION 不属于业务配置键，单独取出
        if (typeof parsed.DEEKAI_EDITION === "string") {
          editionFromFile = parsed.DEEKAI_EDITION;
        }
        break;
      } catch {
        // 忽略无法读取的 .env
      }
    }

    // 2) 启动环境变量覆盖 .env
    const env = this.options.env ?? {};
    for (const key of ALL_CONFIG_KEYS) {
      const value = env[key];
      if (typeof value === "string" && value.trim()) {
        fromFile[key] = value.trim();
      }
    }
    this.base = fromFile;

    // 3) 版本判定：启动环境变量 > .env 文件 > 发行内置配置，默认 release
    this.edition = this.resolveEdition(
      env.DEEKAI_EDITION,
      editionFromFile,
      baseConfig.DEEKAI_EDITION
    );

    // 4) 用户配置：只保留当前版本允许用户覆盖的键
    this.override = this.filterWritable(this.readOverride());
    this.refreshSourceLabel();
  }

  /** 逐级回退：显式设置的值优先，取到第一个合法值；都没有则按发行版处理 */
  private resolveEdition(...candidates: Array<string | undefined>): Edition {
    for (const value of candidates) {
      if (value === "advanced" || value === "release") return value;
    }
    // 默认按发行版处理，避免内部配置泄漏给普通用户
    return "release";
  }

  private writableKeys(): readonly ConfigKey[] {
    return this.edition === "advanced" ? ALL_CONFIG_KEYS : MODEL_KEYS;
  }

  private filterWritable(config: RawConfig): RawConfig {
    const allowed = new Set<ConfigKey>(this.writableKeys());
    const picked: RawConfig = {};
    for (const key of ALL_CONFIG_KEYS) {
      const value = config[key];
      if (typeof value === "string" && value.trim() && allowed.has(key)) {
        picked[key] = value.trim();
      }
    }
    return picked;
  }

  private readOverride(): RawConfig {
    try {
      const file = this.options.configFilePath;
      if (!fs.existsSync(file)) return {};
      return parseConfigObject(JSON.parse(fs.readFileSync(file, "utf-8")));
    } catch {
      return {};
    }
  }

  private refreshSourceLabel(): void {
    const labels: string[] = [];
    if (Object.keys(this.published).length > 0) labels.push("发行内置配置");
    if (Object.keys(this.base).length > 0) labels.push("部署 .env");
    if (Object.keys(this.override).length > 0) labels.push("用户设置");
    this.source = labels.length > 0 ? labels.join(" + ") : "默认（无配置文件）";
  }

  /** 后端内部读取（含敏感项），禁止直接下发前端 */
  get(key: ConfigKey): string | null {
    const isInfra = (INFRA_KEYS as readonly string[]).includes(key);

    if (isInfra) {
      // 基础设施：发行内置 > 部署环境 > 用户配置（仅兼容老的自托管用户，且 release 下不可写入）
      if (this.edition === "advanced") {
        return (
          this.override[key] ?? this.published[key] ?? this.base[key] ?? null
        );
      }
      return (
        this.published[key] ?? this.base[key] ?? this.override[key] ?? null
      );
    }

    // 模型键：用户配置优先
    return (
      this.override[key] ?? this.published[key] ?? this.base[key] ?? null
    );
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

  /** 设置页可覆盖的键；空字符串表示清除该键（白名单外的键会被忽略） */
  save(values: WritableConfig): void {
    const allowed = new Set<ConfigKey>(this.writableKeys());
    const next: RawConfig = { ...this.readOverride() };

    for (const key of ALL_CONFIG_KEYS) {
      if (!allowed.has(key)) continue;
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

    this.override = this.filterWritable(next);
    this.refreshSourceLabel();

    try {
      fs.mkdirSync(path.dirname(this.options.configFilePath), {
        recursive: true,
      });
      fs.writeFileSync(
        this.options.configFilePath,
        JSON.stringify(this.override, null, 2),
        "utf-8"
      );
    } catch (err) {
      throw new Error(`写入配置文件失败: ${(err as Error).message}`);
    }
  }

  /** 前端可见的公开视图（剔除敏感值） */
  publicConfig(): PublicConfig {
    const store = this.computeStore();
    const url = this.get("SUPABASE_URL");
    const anon = this.get("SUPABASE_ANON_KEY");
    const supabaseConfigured = store === "supabase" && Boolean(url && anon);

    return {
      store,
      supabaseConfigured,
      supabaseUrl: url,
      // anon key 本身是公开的（网页端同样直接下发），前端用它直连 Supabase
      supabaseAnonKey: supabaseConfigured ? anon : null,
      deepseekConfigured: Boolean(this.get("DEEPSEEK_API_KEY")),
      model: this.get("DEEPSEEK_MODEL"),
      modelBaseUrl: this.get("DEEPSEEK_BASE_URL"),
      publicWebUrl: this.get("PUBLIC_WEB_URL"),
      edition: this.edition,
      // 只有自托管（advanced）才允许改后端基础设施
      canEditInfra: this.edition === "advanced",
      configSource: this.source,
      appVersion: this.options.version,
      userDataDir: this.options.dataDir,
    };
  }
}
