import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { PublicConfig } from "@shared/bridge-api";
import Chat from "./components/Chat";
import SettingsDialog from "./components/SettingsDialog";
import * as api from "./lib/api";
import { useTheme } from "./lib/theme";
import {
  clearSession,
  SESSION_EXPIRED_MESSAGES,
  useSessionGuard,
  type SessionExpiryReason,
} from "./lib/session";
import {
  getSupabase,
  initSupabase,
  toSessionUser,
  type SessionUser,
} from "./lib/supabase";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import SharedView from "./components/SharedView";

/** 分享链接路由：#/share/<token>（桌面端 file:// 与网页端都可直接打开） */
function readShareToken(): string | null {
  const match = window.location.hash.match(/^#\/share\/([A-Za-z0-9_-]{8,})/);
  return match ? match[1] : null;
}

/**
 * App 门控（对应网页版 middleware.ts 的登录态路由保护）：
 * - 读取主进程配置 -> 初始化 Supabase -> 订阅会话
 * - supabase 模式：未登录展示登录页，已登录进入聊天
 * - 未配置 Supabase：先展示引导页（可去设置，或临时进入内存模式）
 */
export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memoryMode, setMemoryMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adopted, setAdopted] = useState<Set<string>>(new Set());
  /** 会话过期后给登录页的提示文案 */
  const [expiredNotice, setExpiredNotice] = useState("");
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [shareToken, setShareToken] = useState<string | null>(() =>
    readShareToken()
  );
  const [supabaseInited, setSupabaseInited] = useState(false);

  // 分享链接路由（hash 变化时重新判断）
  useEffect(() => {
    const onHashChange = () => setShareToken(readShareToken());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getConfig()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 已配置 Supabase：初始化客户端并订阅登录态
  const supabaseReady =
    Boolean(config?.supabaseConfigured) &&
    Boolean(config?.supabaseUrl) &&
    Boolean(config?.supabaseAnonKey);

  useEffect(() => {
    if (!supabaseReady || !config?.supabaseUrl || !config.supabaseAnonKey) {
      return;
    }
    const client = initSupabase(config.supabaseUrl, config.supabaseAnonKey);
    setSupabaseInited(true);
    let mounted = true;

    client.auth.getSession().then(({ data }) => {
      if (mounted) {
        setUser(data.session?.user ? toSessionUser(data.session.user) : null);
      }
    });

    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) {
          setUser(session?.user ? toSessionUser(session.user) : null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabaseReady, config?.supabaseUrl, config?.supabaseAnonKey]);

  // 登录/注册成功后静默执行老数据认领（只在用户无数据时生效，见主进程）
  useEffect(() => {
    if (!user || adopted.has(user.id)) return;
    setAdopted((prev) => new Set(prev).add(user.id));
    // 模型条目的"登录前配置 → 归到账号名下 + 云端同步"由 useModelOptions 的
    // syncModelStore() 统一处理，这里不重复做，避免时序打架。
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) {
          api.adoptOrphans(data.session.access_token, user.id);
        }
      })
      .catch(() => {});
  }, [user, adopted]);

  const logout = async () => {
    // 主动退出要清掉会话计时，下次登录重新开始计算
    clearSession();
    try {
      await getSupabase().auth.signOut();
    } catch {
      // 忽略登出异常，回到未登录视图即可
    }
  };

  /** 会话到期（空闲超时 / 累计上限）：清掉计时并强制登出 */
  const handleSessionExpire = useCallback((reason: SessionExpiryReason) => {
    clearSession();
    setExpiredNotice(SESSION_EXPIRED_MESSAGES[reason]);
    try {
      getSupabase()
        .auth.signOut()
        .catch(() => {});
    } catch {
      // Supabase 未初始化时忽略
    }
  }, []);

  // 空闲 30 分钟 / 累计 7 天自动登出（Supabase 自身会无限续期，这里补上限制）
  useSessionGuard(Boolean(user), handleSessionExpire);

  // 重新登录成功后清掉上次的过期提示
  useEffect(() => {
    if (user) setExpiredNotice("");
  }, [user]);

  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);

  let view: ReactNode;
  const bootScreen = (
    <div className="boot-screen">
      <span className="spinner boot-spinner" />
      <div>DeekAI 正在启动…</div>
    </div>
  );

  if (shareToken) {
    // 只读分享页：无需登录，只要配置了 Supabase 即可匿名读取
    view = !config ? (
      bootScreen
    ) : !config.supabaseConfigured ? (
      <div className="share-page">
        <div className="share-empty">
          <h2>分享需要云存储配置</h2>
          <p>请先配置 Supabase（SUPABASE_URL / SUPABASE_ANON_KEY）后再打开分享链接。</p>
        </div>
      </div>
    ) : (
      <SharedView token={shareToken} ready={supabaseInited} />
    );
  } else if (!config) {
    view = bootScreen;
  } else if (config.supabaseConfigured) {
    view = user ? (
      <Chat
        userId={user.id}
        store="supabase"
        serverModelProfiles={config.serverModelProfiles}
        onOpenSettings={openSettings}
        publicWebUrl={config.publicWebUrl}
      />
    ) : (
      <Login onOpenSettings={openSettings} expiredNotice={expiredNotice} />
    );
  } else if (!memoryMode) {
    view = (
      <Onboarding
        onOpenSettings={openSettings}
        onContinueMemory={() => setMemoryMode(true)}
      />
    );
  } else {
    view = (
      <Chat
        userId={null}
        store="memory"
        serverModelProfiles={config.serverModelProfiles}
        onOpenSettings={openSettings}
        onExitMemory={() => setMemoryMode(false)}
        publicWebUrl={config.publicWebUrl}
      />
    );
  }

  return (
    <>
      {view}
      <SettingsDialog
        open={settingsOpen}
        config={config}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        user={user}
        bridgeKind={api.bridgeKind}
        store={config?.store ?? "memory"}
        onLogout={logout}
        onClose={closeSettings}
        onSaved={() => {
          closeSettings();
          // 重新加载以按新配置初始化（supabase 客户端 / 门控视图均重建）
          window.location.reload();
        }}
      />
    </>
  );
}
