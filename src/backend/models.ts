import type { ListModelsResult } from "@shared/bridge-api";
import { DEFAULT_MODEL_BASE_URL } from "@shared/model-profiles";

/**
 * 拉取 OpenAI 兼容服务实际可用的模型列表（GET {baseUrl}/models）。
 * 内置的厂商模型清单容易过时，这里让用户能一键拿到服务端的真实列表。
 * 各家返回结构不完全一致，这里同时兼容 { data: [{id}] } 与 { models: [...] }。
 */

export function resolveModelsUrl(baseUrl?: string | null): string {
  const base = (baseUrl?.trim() || DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");
  return `${base}/models`;
}

function pickModelIds(payload: unknown): string[] {
  const source = (payload ?? {}) as {
    data?: unknown;
    models?: unknown;
  };
  const list = Array.isArray(source.data)
    ? source.data
    : Array.isArray(source.models)
      ? source.models
      : [];

  const ids = list
    .map((item) => {
      if (typeof item === "string") return item;
      const record = (item ?? {}) as { id?: unknown; name?: unknown };
      const value = record.id ?? record.name;
      return typeof value === "string" ? value : "";
    })
    .map((id) => id.trim())
    .filter(Boolean);

  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

export async function listModels(options: {
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<ListModelsResult> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return { models: [], error: "请先填写该条目的 API Key" };
  }

  try {
    const response = await fetch(resolveModelsUrl(options.baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        models: [],
        error: `获取模型列表失败 (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`,
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const models = pickModelIds(payload);

    if (models.length === 0) {
      return {
        models: [],
        error: "服务端未返回模型列表（可能不支持 GET /models），请手动填写模型名",
      };
    }

    return { models };
  } catch (err) {
    return {
      models: [],
      error: `获取模型列表出错: ${(err as Error).message}`,
    };
  }
}
