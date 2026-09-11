import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sanitizeModelProfile,
  type ModelProfile,
  type ModelStoreSnapshot,
} from "@shared/model-profiles";

/**
 * 模型配置的云端读写（Supabase 表 user_model_configs，RLS 按 auth.uid() 隔离）。
 *
 * 表结构（见 supabase/migrations/create_user_model_configs.sql）：
 *   user_id (pk) / profiles (jsonb) / default_id / selected_id / updated_at
 *
 * 注意：profiles 里含各条目的 API Key，所以这张表等同用户凭据，
 * 只有本人可读写（RLS 兜底），不要开放匿名读。
 */

const TABLE = "user_model_configs";

interface ModelConfigRow {
  profiles: unknown;
  default_id: string | null;
  selected_id: string | null;
}

function normalize(row: ModelConfigRow): ModelStoreSnapshot {
  const list = Array.isArray(row.profiles) ? row.profiles : [];
  const profiles = list
    .map((item, index) =>
      sanitizeModelProfile(item, `cloud-${index}`)
    )
    .filter((item): item is ModelProfile => item !== null);

  return {
    profiles,
    defaultId: typeof row.default_id === "string" ? row.default_id : "",
    selectedId: typeof row.selected_id === "string" ? row.selected_id : "",
  };
}

/** 读取云端配置；该账号还没有记录时返回 null（区别于"有记录但为空"） */
export async function loadCloudStore(
  client: SupabaseClient,
  userId: string
): Promise<ModelStoreSnapshot | null> {
  const { data, error } = await client
    .from(TABLE)
    .select("profiles, default_id, selected_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`读取云端模型配置失败: ${error.message}`);
  }
  if (!data) return null;
  return normalize(data as ModelConfigRow);
}

/** 覆盖写入云端配置（按 user_id upsert，一行一个账号） */
export async function saveCloudStore(
  client: SupabaseClient,
  userId: string,
  store: ModelStoreSnapshot
): Promise<void> {
  const { error } = await client.from(TABLE).upsert(
    {
      user_id: userId,
      profiles: store.profiles,
      default_id: store.defaultId,
      selected_id: store.selectedId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(`保存云端模型配置失败: ${error.message}`);
  }
}
