/**
 * 网页后端的登录态校验。
 *
 * 只依赖 Supabase 公开的 anon key，不需要 JWT secret：
 * 拿调用方给的 access token 去问 Supabase「这个 token 对应哪个用户」，
 * 失败（过期 / 伪造 / 已登出）就返回 null。
 *
 * 这样即使有人绕过前端直接打 /api/chat，也必须在 Supabase 那边有一个有效会话。
 */

export interface TokenUser {
  id: string;
  email: string | null;
}

export interface SupabaseAuthConfig {
  url: string | null;
  anonKey: string | null;
}

/** 校验 access token；通过返回用户，否则返回 null */
export async function verifyAccessToken(
  token: string,
  config: SupabaseAuthConfig
): Promise<TokenUser | null> {
  const { url, anonKey } = config;
  if (!token || !url || !anonKey) return null;

  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/auth/v1/user`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) return null;

    const user = (await response.json()) as { id?: string; email?: string };
    if (typeof user?.id !== "string" || !user.id) return null;

    return { id: user.id, email: user.email ?? null };
  } catch {
    // 网络异常等一律视为未通过
    return null;
  }
}
