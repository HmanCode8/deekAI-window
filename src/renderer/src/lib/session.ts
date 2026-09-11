import { useEffect } from "react";

/**
 * 登录会话策略（应用层兜底）。
 *
 * 背景：Supabase 默认会用 refresh token 无限续期，只要客户端还在跑，会话就永不过期。
 * 所以这里额外加两道限制，任一触发就主动登出并要求重新登录：
 *
 *   1) 空闲超时：连续不操作超过 IDLE_LIMIT_MS；
 *   2) 绝对上限：从登录算起超过 MAX_SESSION_MS（无论是否活跃）。
 *
 * 记录存在 localStorage，全局只有一条（同一时刻只可能有一个会话）。
 * 注意：这是客户端约束，能挡住"一直挂着不退出"，但拦不住手工伪造存储；
 * 真正的兜底在服务端——/api/chat、/api/upload 会校验 token（见 backend/supabase-auth.ts）。
 */

const SESSION_KEY = "deekai:session";

/** 空闲多久算掉线 */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;
/** 一次登录最长能用多久 */
export const MAX_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
/** 记录活跃时间的节流间隔，避免鼠标一动就写 localStorage */
const TOUCH_THROTTLE_MS = 30 * 1000;
/** 定时检查间隔 */
const CHECK_INTERVAL_MS = 30 * 1000;

interface SessionRecord {
  /** 本次登录的起始时间 */
  startedAt: number;
  /** 最后一次操作时间 */
  lastActiveAt: number;
}

export type SessionExpiryReason = "idle" | "absolute";

export const SESSION_EXPIRED_MESSAGES: Record<SessionExpiryReason, string> = {
  idle: "长时间未操作，登录已自动退出，请重新登录。",
  absolute: "登录已超过 7 天，请重新登录。",
};

function writeSession(record: SessionRecord): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(record));
  } catch {
    // 忽略写入失败
  }
}

export function readSession(): SessionRecord | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (
      typeof parsed.startedAt !== "number" ||
      typeof parsed.lastActiveAt !== "number"
    ) {
      return null;
    }
    return { startedAt: parsed.startedAt, lastActiveAt: parsed.lastActiveAt };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // 忽略
  }
}

/**
 * 登录后开始计时。已有记录就沿用（刷新页面不该重置 7 天上限），
 * 没有才新建——所以退出登录时必须显式 clearSession()。
 */
export function ensureSession(now = Date.now()): SessionRecord {
  const existing = readSession();
  if (existing) return existing;
  const fresh: SessionRecord = { startedAt: now, lastActiveAt: now };
  writeSession(fresh);
  return fresh;
}

/** 记录一次用户活跃（有节流，可放心绑在鼠标/键盘事件上） */
export function touchSession(now = Date.now()): void {
  const current = readSession();
  if (!current) return;
  if (now - current.lastActiveAt < TOUCH_THROTTLE_MS) return;
  writeSession({ ...current, lastActiveAt: now });
}

/** 判断是否过期；未过期返回 null */
export function checkSession(now = Date.now()): SessionExpiryReason | null {
  const current = readSession();
  if (!current) return null;
  if (now - current.startedAt >= MAX_SESSION_MS) return "absolute";
  if (now - current.lastActiveAt >= IDLE_LIMIT_MS) return "idle";
  return null;
}

/** 计入"活跃"的事件；都是 passive 监听，不影响滚动与输入性能 */
const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "wheel",
  "touchstart",
  "focus",
] as const;

/**
 * 会话守卫：enabled 为真（已登录）时开始计时与检查，到期调用 onExpire。
 * onExpire 必须是稳定引用（用 useCallback 包一下），否则会反复重建定时器。
 */
export function useSessionGuard(
  enabled: boolean,
  onExpire: (reason: SessionExpiryReason) => void
): void {
  useEffect(() => {
    if (!enabled) return;

    ensureSession();

    // 应用可能被挂起很久才唤醒，进入时先判一次
    const initial = checkSession();
    if (initial) {
      onExpire(initial);
      return;
    }

    const onActivity = () => touchSession();
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true });
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      touchSession();
      const reason = checkSession();
      if (reason) onExpire(reason);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timer = window.setInterval(() => {
      const reason = checkSession();
      if (reason) onExpire(reason);
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [enabled, onExpire]);
}
