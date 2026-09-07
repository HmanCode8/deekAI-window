import { createClient } from "@supabase/supabase-js";

/**
 * 老数据认领（主进程，一次性系统操作）：
 * 迁移前（无 user_id）的历史数据归给首个登录且暂无数据的账号。
 * 规则与网页版 lib/auth.ts adoptOrphanRows 保持一致：
 * 仅当该用户还没有任何会话时才执行，避免覆盖。
 * 业务读写仍由渲染进程用「anon + 用户 token」走 RLS，这里只做系统级兜底。
 */
export async function adoptOrphanRows(
  accessToken: string,
  userId: string,
  env: {
    url: string | null;
    anonKey: string | null;
    serviceKey: string | null;
  }
): Promise<{ adopted: boolean }> {
  if (!env.url || !env.anonKey) {
    return { adopted: false };
  }

  try {
    const scoped = createClient(env.url, env.anonKey, {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { count } = await scoped
      .from("conversations")
      .select("id", { count: "exact", head: true });
    if (count && count > 0) return { adopted: false };

    if (!env.serviceKey) return { adopted: false };

    const admin = createClient(env.url, env.serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    await admin
      .from("conversations")
      .update({ user_id: userId })
      .is("user_id", null);
    await admin
      .from("projects")
      .update({ user_id: userId })
      .is("user_id", null);

    return { adopted: true };
  } catch {
    // 认领失败不影响正常使用，静默忽略
    return { adopted: false };
  }
}
