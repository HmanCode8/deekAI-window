import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { Edition, PublicConfig, WritableConfig } from "./bridge-api";
import type { StoreMode } from "./chat-types";
import {
  BUILTIN_PROFILE_ID,
  parseModelProfiles,
  profileSupportsFiles,
  profileVisionModel,
  toPublicProfile,
  type ModelProfile,
  type PublicModelProfile,
  type ResolvedModel,
} from "./model-profiles";
import { MODELS } from "./attachments";

/**
 * 配置核心（两端共享的纯逻辑，不依赖 Electron / Express）。
 *
 * 配置被拆成两类，权限与存储位置都不同：
 *
 * 1) 实例配置（本文件负责）—— 由运营方维护，使用者改不了：
 *    - 基础设施键 INFRA_KEYS：发行内置 app-config.json / 部署 .env / 启动环境变量
 *      （仅 advanced 自托管版允许在应用内修改）
 *    - 运营方模型键 OPERATOR_MODEL_KEYS：运营方预置的"兜底模型条目"，只读
 *
 * 2) 用户模型配置（渲染层负责，见 model-profiles.ts）—— 使用者自己的模型条目，
 *    按账号存在本机 / 浏览器本地（localStorage），随请求以 inline 形式带给后端，
 *    不写入服务端磁盘、不入库，因此天然按账号隔离。
 *
 * 取值优先级：
 *   基础设施：发行内置配置 > 部署环境变量；用户配置永不参与
 *   运营方模型条目：发行内置配置 > 部署环境变量
 *
 * 版本（edition）判定优先级：
 *   启动环境变量 DEEKAI_EDITION > .env 文件 DEEKAI_EDITION > 发行内置 app-config.json，默认 release
 */

/** 基础设施键（运营方）：release 下前端完全不可见、不可改；advanced 可在应用内修改 */
export const INFRA_KEYS = [
  "DATA_STORE",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PUBLIC_WEB_URL",
] as const;

/**
 * 运营方预置的模型键：随包内置或部署环境提供，使用者只读。
 * 用户自己的模型条目不走这里，而是存在客户端本地（见 renderer lib/model-profiles.ts）。
 */
export const OPERATOR_MODEL_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  /** 运营方批量预置的条目（JSON 数组字符串） */
  "MODEL_PROFILES",
  /** 运营方指定的默认条目 id */
  "DEFAULT_MODEL_PROFILE",
] as const;

export const ALL_CONFIG_KEYS = [
  ...INFRA_KEYS,
  ...OPERATOR_MODEL_KEYS,
] as const;

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

    // 4) 用户/运维文件：按版本决定接受哪些键
    this.override = this.filterByKeys(
      this.readOverride(),
      this.readableOverrideKeys()
    );
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

  /**
   * 设置面板能写的键：release 一律不可写（模型条目也不走这里，而是存在客户端本地）；
   * advanced 自托管版只允许改基础设施。
   */
  private writableKeys(): readonly ConfigKey[] {
    return this.edition === "advanced" ? INFRA_KEYS : [];
  }

  /**
   * 启动时从用户文件里接受哪些键。
   * release 下不接受基础设施键（保持"用户改不动后端配置"的保证），
   * 但接受运营方模型键——它可能来自早期版本或运维手工写入，认它不会有副作用。
   */
  private readableOverrideKeys(): readonly ConfigKey[] {
    return this.edition === "advanced" ? ALL_CONFIG_KEYS : OPERATOR_MODEL_KEYS;
  }

  private filterByKeys(
    config: RawConfig,
    allowed: readonly ConfigKey[]
  ): RawConfig {
    const allow = new Set<ConfigKey>(allowed);
    const picked: RawConfig = {};
    for (const key of ALL_CONFIG_KEYS) {
      const value = config[key];
      if (typeof value === "string" && value.trim() && allow.has(key)) {
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

  /**
   * 内置兜底条目：由 DEEPSEEK_* 三个键合成，永远排在最前且不可删除。
   * 这样"一条都没配"时应用仍有一个可用的 DeepSeek 位置（保底），
   * 用户只要往里填 Key 就能用；编辑它等同于写 DEEPSEEK_* 键。
   */
  private builtinProfile(): ModelProfile {
    return {
      id: BUILTIN_PROFILE_ID,
      name: "DeepSeek（内置）",
      providerId: "deepseek",
      baseUrl: this.get("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
      model: this.get("DEEPSEEK_MODEL") ?? MODELS[0].id,
      apiKey: this.get("DEEPSEEK_API_KEY") ?? "",
    };
  }

  /** 全部模型条目（含密钥，仅后端内部使用）：内置保底条目 + 用户自定义条目 */
  listModelProfiles(): ModelProfile[] {
    return [
      this.builtinProfile(),
      ...parseModelProfiles(this.get("MODEL_PROFILES")),
    ];
  }

  /**
   * 下发给渲染进程的运营方条目（剔除密钥）。
   * 只下发"已经配好 Key"的条目——没有 Key 的条目用户既用不了也改不了，
   * 出现在列表里只会造成困惑；这种情况下用户自己在「模型设置」里加条目即可。
   */
  publicModelProfiles(): PublicModelProfile[] {
    return this.listModelProfiles()
      .filter((profile) => Boolean(profile.apiKey))
      .map((profile) =>
        toPublicProfile(profile, {
          isBuiltin: profile.id === BUILTIN_PROFILE_ID,
        })
      );
  }

  /** 服务端默认条目 id（运营方指定 > 第一个配好 Key 的 > 内置） */
  private resolveDefaultProfileId(): string {
    const profiles = this.listModelProfiles();
    const explicit = this.get("DEFAULT_MODEL_PROFILE");
    if (explicit && profiles.some((p) => p.id === explicit)) return explicit;
    return profiles.find((p) => p.apiKey)?.id ?? BUILTIN_PROFILE_ID;
  }

  /**
   * 按 id 解析出一次模型调用所需的全部信息（含密钥）。
   * 传入的 id 不存在时回退到默认条目——保证"切了模型但配置被删"不会直接报错。
   */
  resolveModel(profileId?: string | null): ResolvedModel {
    const profiles = this.listModelProfiles();
    const byId = (id?: string | null) =>
      id ? profiles.find((profile) => profile.id === id) : undefined;

    const chosen =
      byId(profileId) ?? byId(this.resolveDefaultProfileId()) ?? profiles[0];

    return {
      id: chosen.id,
      name: chosen.name,
      providerId: chosen.providerId,
      baseUrl: chosen.baseUrl,
      model: chosen.model,
      apiKey: chosen.apiKey,
      supportsFiles: profileSupportsFiles(chosen),
      visionModel: profileVisionModel(chosen),
    };
  }

  /**
   * 写入实例配置。只接受当前版本允许的键（release 一律拒绝，advanced 仅基础设施），
   * 空字符串表示清除该键。模型条目不在这里——它属于用户配置，存在客户端本地。
   */
  save(values: WritableConfig): void {
    const allowed = new Set<ConfigKey>(this.writableKeys());
    const next: RawConfig = { ...this.readOverride() };
    // WritableConfig 只声明了可写键；这里按白名单遍历，未声明的键一律忽略
    const input = values as Partial<Record<ConfigKey, string>>;

    for (const key of ALL_CONFIG_KEYS) {
      if (!allowed.has(key)) continue;
      const value = input[key];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          next[key] = trimmed;
        } else {
          delete next[key];
        }
      }
    }

    this.override = this.filterByKeys(next, this.readableOverrideKeys());
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
      // 只下发运营方预置条目；用户自己的条目存在客户端本地
      serverModelProfiles: this.publicModelProfiles(),
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
