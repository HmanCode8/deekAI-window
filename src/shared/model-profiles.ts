import { MODELS, VISION_MODEL_ID } from "./attachments";

/**
 * 模型配置条目（多模型 / 多厂商）。
 *
 * 设计要点：
 * - 所有人都是「OpenAI 兼容」协议：请求 {baseUrl}/chat/completions，模型列表 GET {baseUrl}/models。
 *   新厂商只要兼容这套协议，加一条预设即可，业务代码不用动。
 * - 条目 = 自定义显示名 + 厂商预设（或自定义）+ Base URL + 厂商真实模型 id + 自己的 Key。
 * - DeepSeek 为保底：即使一条都没配，配置层也会合成一个内置 DeepSeek 条目。
 * - 文件解析能力按条目判定：目前只有 DeepSeek 官方提供 Files API（图片上传），
 *   其余条目自动禁用图片附件，文档类附件（本地解析）不受影响。
 */

/** 自定义厂商（不使用预设） */
export const CUSTOM_PROVIDER_ID = "custom";

/** 默认模型服务地址（未配置任何条目时的兜底） */
export const DEFAULT_MODEL_BASE_URL = "https://api.deepseek.com";

/** 内置兜底条目的固定 id（由 DEEPSEEK_* 配置合成，不可删除） */
export const BUILTIN_PROFILE_ID = "builtin-deepseek";

export interface ProviderPreset {
  id: string;
  /** 显示名 */
  label: string;
  /** OpenAI 兼容根地址（不含 /chat/completions） */
  baseUrl: string;
  /**
   * 常见模型清单。厂商出新品后这里会过时，
   * 因此设置面板提供「从服务端获取」（GET {baseUrl}/models）与手填作为兜底。
   */
  models: string[];
  docsUrl?: string;
  /** 是否提供 Files API（决定该条目能否上传图片附件） */
  supportsFiles?: boolean;
  /** 需要读图时改用哪个模型（目前仅 DeepSeek 需要单独切换视觉模型） */
  visionModel?: string;
  /** 该厂商的特殊说明 */
  note?: string;
}

/** 主流厂商预设（顺序即设置面板里的展示顺序） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: MODELS.map((m) => m.id),
    supportsFiles: true,
    visionModel: VISION_MODEL_ID,
    docsUrl: "https://platform.deepseek.com/api-docs",
    note: "唯一支持图片附件（Files API）的厂商；文档类附件所有厂商都能用。",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "o3",
      "o4-mini",
    ],
    docsUrl: "https://platform.openai.com/docs/api-reference",
    note: "国内网络通常需要自备代理，或改用兼容 OpenAI 协议的国内中转服务。",
  },
  {
    id: "dashscope",
    label: "通义千问（阿里云百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      "qwen-max",
      "qwen-plus",
      "qwen-turbo",
      "qwen-vl-max",
      "qwen2.5-72b-instruct",
    ],
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
    note: "必须用「兼容模式」地址（带 /compatible-mode/v1）。",
  },
  {
    id: "moonshot",
    label: "Kimi（Moonshot）",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
      "kimi-k2-0711-preview",
    ],
    docsUrl: "https://platform.moonshot.cn/docs",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v-plus"],
    docsUrl: "https://open.bigmodel.cn/dev/api",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct",
    ],
    docsUrl: "https://docs.siliconflow.cn/",
    note: "模型名带组织前缀（如 deepseek-ai/DeepSeek-V3），建议用「从服务端获取」选。",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.0-flash-001",
    ],
    docsUrl: "https://openrouter.ai/docs",
    note: "聚合多家模型，模型名形如 厂商/模型。",
  },
  {
    id: "doubao",
    label: "豆包（火山方舟）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
    docsUrl: "https://www.volcengine.com/docs/82379",
    note: "模型名需填控制台创建的「接入点 ID」（形如 ep-xxxxxxxx），无固定清单，请手动填写。",
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: "自定义（OpenAI 兼容）",
    baseUrl: "",
    models: [],
    note: "任何兼容 OpenAI 协议的服务：填写 Base URL（不必带 /chat/completions）与模型名即可。",
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function getProviderLabel(id: string): string {
  return getProviderPreset(id)?.label ?? "自定义";
}

/** 一条模型配置（含密钥，仅后端使用，不下发渲染进程） */
export interface ModelProfile {
  id: string;
  /** 自定义显示名，例如「我的 GPT-4o」 */
  name: string;
  providerId: string;
  /** OpenAI 兼容根地址 */
  baseUrl: string;
  /** 厂商真实模型 id */
  model: string;
  apiKey: string;
}

/**
 * 一份完整的用户模型配置（本机存储与云端同步共用同一结构）。
 * - 本机：localStorage 的 deekai:models:<userId>
 * - 云端：Supabase 表 user_model_configs 的一行
 */
export interface ModelStoreSnapshot {
  profiles: ModelProfile[];
  /** 默认使用的条目 id（新会话初始选中） */
  defaultId: string;
  /** 上次手动选择的条目 id（按账号记住） */
  selectedId: string;
}

/**
 * 一次模型调用的目标。两种来源，Key 的归属不同：
 * - profile：用服务端/运营方预置的条目，Key 留在服务端，调用方只传 id
 * - inline ：用调用方自己（本机 / 浏览器）保存的条目，Key 随请求带上，服务端不落盘
 */
export type ModelTarget =
  | { kind: "profile"; profileId: string }
  | {
      kind: "inline";
      name?: string;
      providerId?: string;
      baseUrl: string;
      model: string;
      apiKey: string;
    };

/** 把调用目标解析成后端需要的运行时信息；profile 类型交给配置层查表 */
export function toResolvedModel(
  target: ModelTarget | null | undefined,
  resolveProfile: (profileId?: string | null) => ResolvedModel
): ResolvedModel {
  if (target?.kind === "inline") {
    return {
      id: "inline",
      name: target.name?.trim() || target.model || "未命名模型",
      providerId: target.providerId?.trim() || CUSTOM_PROVIDER_ID,
      baseUrl: target.baseUrl?.trim() ?? "",
      model: target.model?.trim() ?? "",
      apiKey: target.apiKey?.trim() ?? "",
      supportsFiles: profileSupportsFiles(target),
      visionModel: profileVisionModel(target),
    };
  }

  return resolveProfile(target?.kind === "profile" ? target.profileId : null);
}

/** 校验来自网络/渲染进程的目标对象（边界处只信任形状合法的数据） */
export function sanitizeModelTarget(input: unknown): ModelTarget | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (raw.kind === "profile") {
    const profileId = toTrimmedString(raw.profileId);
    return profileId ? { kind: "profile", profileId } : null;
  }
  if (raw.kind === "inline") {
    const baseUrl = toTrimmedString(raw.baseUrl);
    const model = toTrimmedString(raw.model);
    if (!baseUrl || !model) return null;
    return {
      kind: "inline",
      name: toTrimmedString(raw.name) || undefined,
      providerId: toTrimmedString(raw.providerId) || undefined,
      baseUrl,
      model,
      apiKey: toTrimmedString(raw.apiKey),
    };
  }
  return null;
}

/**
 * 一次模型调用所需的全部运行时信息（含密钥）。
 * 由配置层按条目 id 解析后传给能力层（backend），能力层不关心它从哪来。
 */
export interface ResolvedModel {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  supportsFiles: boolean;
  visionModel: string | null;
}

/** 下发渲染进程的模型配置（剔除密钥） */
export interface PublicModelProfile {
  id: string;
  name: string;
  providerId: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  /** 是否已配置 Key（不回显 Key 本身） */
  hasKey: boolean;
  /** 该条目是否支持图片附件（Files API） */
  supportsFiles: boolean;
  /** 该条目是否需要按图片自动切换视觉模型 */
  visionModel: string | null;
  /** 内置兜底条目：不可删除 */
  isBuiltin: boolean;
}

/** 判断某个地址是否为 DeepSeek 官方（唯一提供 Files API 的厂商） */
export function isDeepSeekBaseUrl(baseUrl?: string | null): boolean {
  const base = (baseUrl ?? "").trim().toLowerCase();
  return base.includes("api.deepseek.com");
}

/** 解析该条目是否支持图片附件 */
export function profileSupportsFiles(profile: {
  providerId?: string;
  baseUrl?: string | null;
}): boolean {
  const preset = profile.providerId
    ? getProviderPreset(profile.providerId)
    : undefined;
  if (preset?.supportsFiles) return true;
  return isDeepSeekBaseUrl(profile.baseUrl);
}

/** 该条目在读图时应改用哪个模型（不需要切换则返回 null） */
export function profileVisionModel(profile: {
  providerId?: string;
  baseUrl?: string | null;
}): string | null {
  const preset = profile.providerId
    ? getProviderPreset(profile.providerId)
    : undefined;
  if (preset?.visionModel) return preset.visionModel;
  return isDeepSeekBaseUrl(profile.baseUrl) ? VISION_MODEL_ID : null;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 规范化一条外部传入的配置（用于反序列化与保存前的校验） */
export function sanitizeModelProfile(
  input: unknown,
  fallbackId: string
): ModelProfile | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const model = toTrimmedString(raw.model);
  const baseUrl = toTrimmedString(raw.baseUrl);
  const apiKey = toTrimmedString(raw.apiKey);
  const providerId = toTrimmedString(raw.providerId) || CUSTOM_PROVIDER_ID;

  // 没模型也没地址的条目视为无效，直接丢弃
  if (!model && !baseUrl) return null;

  const name = toTrimmedString(raw.name) || model || "未命名模型";

  return {
    id: toTrimmedString(raw.id) || fallbackId,
    name,
    providerId,
    baseUrl: baseUrl || getProviderPreset(providerId)?.baseUrl || "",
    model,
    apiKey,
  };
}

/** 解析配置文件里的 MODEL_PROFILES（JSON 字符串），容错返回空数组 */
export function parseModelProfiles(raw: string | null): ModelProfile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => sanitizeModelProfile(item, `profile-${index}`))
      .filter((item): item is ModelProfile => item !== null);
  } catch {
    return [];
  }
}

export function serializeModelProfiles(profiles: ModelProfile[]): string {
  return JSON.stringify(
    profiles.map(({ id, name, providerId, baseUrl, model, apiKey }) => ({
      id,
      name,
      providerId,
      baseUrl,
      model,
      apiKey,
    }))
  );
}

/** 转换成可下发渲染进程的公开结构 */
export function toPublicProfile(
  profile: ModelProfile,
  options: { isBuiltin?: boolean } = {}
): PublicModelProfile {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    providerLabel: getProviderLabel(profile.providerId),
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasKey: Boolean(profile.apiKey),
    supportsFiles: profileSupportsFiles(profile),
    visionModel: profileVisionModel(profile),
    isBuiltin: Boolean(options.isBuiltin),
  };
}
