import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOM_PROVIDER_ID,
  getProviderLabel,
  profileSupportsFiles,
  profileVisionModel,
  sanitizeModelProfile,
  type ModelProfile,
  type ModelStoreSnapshot,
  type ModelTarget,
  type PublicModelProfile,
} from "@shared/model-profiles";
import { loadCloudStore, saveCloudStore } from "./model-cloud";
import { getSupabase } from "./supabase";

/**
 * 用户自己的模型条目 —— 两份存储，内容一致：
 *
 * 1) 本机 localStorage，按登录账号分键（deekai:models:<userId>）；
 *    未登录/内存模式是 deekai:models:local。它是"即时可用 + 离线兜底"的缓存。
 * 2) 云端 Supabase 表 user_model_configs（RLS 按 auth.uid() 隔离），登录后同步，
 *    因此同一账号在网页端 / 桌面端 / 不同电脑上都能拿到同一份配置。
 *
 * 同步规则（见 syncModelStore）：
 * - 登录后拉云端；云端还没有记录就把本机这份上传；
 * - 登录前在设置里配的匿名条目（deekai:models:local）会并进来，不会白配；
 * - 云端有记录时以云端为准，本机缓存被覆盖（避免旧缓存把已删除的条目"复活"）；
 * - 云端不可用（未配置 Supabase / 网络异常）时全部退回本机，功能不受影响。
 *
 * 运营方预置的条目（app-config.json / .env，含 Key）由 PublicConfig.serverModelProfiles
 * 下发，只读、不可编辑，作为「内置模型」出现在列表尾部。
 */

const STORAGE_PREFIX = "deekai:models:";
const CHANGED_EVENT = "deekai:models-changed";

/** 本机存储与云端同步共用的结构（见 shared/model-profiles.ts） */
export type LocalModelStore = ModelStoreSnapshot;

/** 与运行形态无关的模型选项：Chat 与设置面板都基于它渲染 */
export interface ModelOption {
  id: string;
  name: string;
  providerId: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  supportsFiles: boolean;
  visionModel: string | null;
  hasKey: boolean;
  /** true = 运营方预置（只读，不可编辑/删除） */
  readonly: boolean;
  /** 调用时提交给后端的目标 */
  target: ModelTarget;
}

const EMPTY_STORE: LocalModelStore = { profiles: [], defaultId: "", selectedId: "" };

function storageKey(userId: string | null): string {
  return STORAGE_PREFIX + (userId ?? "local");
}

export function loadLocalStore(userId: string | null): LocalModelStore {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...EMPTY_STORE };

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const list = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    const profiles = list
      .map((item, index) =>
        sanitizeModelProfile(item, `local-${index}`)
      )
      .filter((item): item is ModelProfile => item !== null);

    return {
      profiles,
      defaultId: typeof parsed.defaultId === "string" ? parsed.defaultId : "",
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : "",
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

/** 写入本机存储并通知界面刷新（无需重载页面） */
export function saveLocalStore(
  userId: string | null,
  patch: Partial<LocalModelStore>
): LocalModelStore {
  const next: LocalModelStore = { ...loadLocalStore(userId), ...patch };
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // 忽略写入失败（隐私模式等）
  }
  window.dispatchEvent(
    new CustomEvent(CHANGED_EVENT, { detail: { userId } })
  );
  return next;
}

export function clearLocalStore(userId: string | null): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // 忽略
  }
  window.dispatchEvent(
    new CustomEvent(CHANGED_EVENT, { detail: { userId } })
  );
}

/** 后台把配置推到云端；失败只打日志，不影响本地使用 */
function pushCloudInBackground(userId: string, store: LocalModelStore): void {
  try {
    saveCloudStore(getSupabase(), userId, store).catch((err) => {
      console.error("同步云端模型配置失败", err);
    });
  } catch {
    // Supabase 未初始化（未配置云端）时忽略
  }
}

/**
 * 登录后同步一次：拉云端 → 合并"登录前配的匿名条目" → 回写云端与本机。
 * 云端读取失败会抛出，调用方应退回本机缓存。
 */
export async function syncModelStore(
  userId: string
): Promise<LocalModelStore> {
  const client = getSupabase();
  const anonymous = loadLocalStore(null);
  const cloud = await loadCloudStore(client, userId);
  const base = cloud ?? loadLocalStore(userId);

  const known = new Set(base.profiles.map((profile) => profile.id));
  const extras = anonymous.profiles.filter((profile) => !known.has(profile.id));
  const merged: LocalModelStore = {
    profiles: [...base.profiles, ...extras],
    defaultId: base.defaultId || anonymous.defaultId,
    selectedId: base.selectedId || anonymous.selectedId,
  };

  const hasContent =
    merged.profiles.length > 0 ||
    Boolean(merged.defaultId) ||
    Boolean(merged.selectedId);
  const needsUpload = cloud
    ? extras.length > 0 ||
      merged.defaultId !== cloud.defaultId ||
      merged.selectedId !== cloud.selectedId
    : hasContent;

  // 先上传（可能抛错），成功后再动本机，避免"云端失败但本地已清"造成数据丢失
  if (needsUpload) {
    await saveCloudStore(client, userId, merged);
  }

  const hasAnonymous =
    anonymous.profiles.length > 0 ||
    Boolean(anonymous.defaultId) ||
    Boolean(anonymous.selectedId);
  if (hasAnonymous) clearLocalStore(null);

  return saveLocalStore(userId, merged);
}

/**
 * 保存模型配置：先落本机（立即生效），再同步云端（传了 client 才同步）。
 * 云端失败会抛出，调用方据此提示；本机那份已经保存好了。
 */
export async function saveModelStore(
  userId: string | null,
  patch: Partial<LocalModelStore>,
  client: SupabaseClient | null
): Promise<LocalModelStore> {
  const saved = saveLocalStore(userId, patch);
  if (client && userId) {
    await saveCloudStore(client, userId, saved);
  }
  return saved;
}

export function toOptionFromLocal(profile: ModelProfile): ModelOption {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    providerLabel: getProviderLabel(profile.providerId),
    baseUrl: profile.baseUrl,
    model: profile.model,
    supportsFiles: profileSupportsFiles(profile),
    visionModel: profileVisionModel(profile),
    hasKey: Boolean(profile.apiKey),
    readonly: false,
    target: {
      kind: "inline",
      name: profile.name,
      providerId: profile.providerId || CUSTOM_PROVIDER_ID,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
    },
  };
}

export function toOptionFromServer(profile: PublicModelProfile): ModelOption {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    providerLabel: profile.providerLabel,
    baseUrl: profile.baseUrl,
    model: profile.model,
    supportsFiles: profile.supportsFiles,
    visionModel: profile.visionModel,
    hasKey: profile.hasKey,
    readonly: true,
    target: { kind: "profile", profileId: profile.id },
  };
}

/**
 * 订阅某个账号的模型配置。返回本机条目、运营方条目与合并后的选项列表，
 * 并负责"选中项失效时自动回退"的逻辑。
 *
 * @param remote 为 true 时启用云端同步（登录 + 已配置 Supabase）
 */
export function useModelOptions(
  userId: string | null,
  serverProfiles: PublicModelProfile[],
  remote = false
) {
  const [store, setStore] = useState<LocalModelStore>(() =>
    loadLocalStore(userId)
  );

  // 订阅本机存储变化（设置面板保存、切换选中项都会派发，含云端同步后的回写）
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if (detail?.userId === userId) setStore(loadLocalStore(userId));
    };
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHANGED_EVENT, onChange);
  }, [userId]);

  // 切换账号：先显示本机缓存，再从云端拉取覆盖
  useEffect(() => {
    setStore(loadLocalStore(userId));
    if (!userId || !remote) return;

    let cancelled = false;
    syncModelStore(userId)
      .then((merged) => {
        if (!cancelled) setStore(merged);
      })
      .catch((err) => {
        console.error("同步云端模型配置失败，暂用本机缓存", err);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, remote]);

  const serverOptions = serverProfiles.map(toOptionFromServer);
  const localOptions = store.profiles.map(toOptionFromLocal);
  const options = [...localOptions, ...serverOptions];

  // 选中项失效（条目被删/被改名）时逐级回退，保证始终有一个可用目标
  const selected =
    options.find((option) => option.id === store.selectedId) ??
    options.find((option) => option.id === store.defaultId) ??
    options.find((option) => option.hasKey) ??
    options[0] ??
    null;

  const setSelectedId = useCallback(
    (id: string) => {
      const saved = saveLocalStore(userId, { selectedId: id });
      // 顺手把"上次选中的模型"也同步过去，换设备时能接上
      if (remote && userId) pushCloudInBackground(userId, saved);
    },
    [userId, remote]
  );

  return { store, options, localOptions, serverOptions, selected, setSelectedId };
}
