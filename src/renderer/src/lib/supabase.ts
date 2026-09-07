import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

/**
 * Supabase 渲染进程客户端（单例）：
 * - anon key 为公开值（等同网页端直接下发），数据隔离靠「用户会话 token + 数据库 RLS」
 * - 会话默认持久化到 localStorage 并自动续期，与网页浏览器行为一致
 */

let client: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  client = createClient(url, anonKey);
  return client;
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error("Supabase 尚未初始化");
  }
  return client;
}

export interface SessionUser {
  id: string;
  email: string;
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email ?? "",
  };
}
