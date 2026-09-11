import { useEffect, useRef, useState, type FormEvent } from "react";
import { Monitor, Moon, Save, Sun, Trash2, User } from "lucide-react";
import type {
  BridgeKind,
  PublicConfig,
  WritableConfig,
} from "@shared/bridge-api";
import { THEME_LABELS, type ThemeMode } from "../../lib/theme";
import { fileToAvatarDataUrl, loadAvatar, saveAvatar } from "../../lib/profile";
import { saveModelStore } from "../../lib/model-profiles";
import { getSupabase } from "../../lib/supabase";
import * as api from "../../lib/api";

/**
 * 「用户设置」Tab：账号 / 外观 / 后端基础设施（仅 advanced）/ 关于。
 * 模型相关配置在「模型设置」Tab 里，两者互不干扰（保存时只提交本 Tab 负责的键）。
 */

interface SettingsGeneralTabProps {
  config: PublicConfig | null;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  user: { id: string; email: string } | null;
  bridgeKind: BridgeKind;
  store: "memory" | "supabase";
  onLogout: () => void;
  onClose: () => void;
  onSaved: () => void;
}

export default function SettingsGeneralTab({
  config,
  themeMode,
  onThemeChange,
  user,
  bridgeKind,
  store,
  onLogout,
  onClose,
  onSaved,
}: SettingsGeneralTabProps) {
  const [dataStore, setDataStore] = useState("supabase");
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDataStore(config?.store === "memory" ? "memory" : "supabase");
    setUrl(config?.supabaseUrl ?? "");
    setAnonKey(config?.supabaseAnonKey ?? "");
    // 敏感值不回显
    setServiceKey("");
    setWebUrl(config?.publicWebUrl ?? "");
    setAvatar(loadAvatar(user?.id ?? null));
    setAvatarError("");
    setError("");
    setBusy(false);
  }, [config, user?.id]);

  const pickAvatar = async (file: File | null) => {
    if (!file) return;
    setAvatarError("");
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      saveAvatar(user?.id ?? null, dataUrl);
      setAvatar(dataUrl);
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const removeAvatar = () => {
    saveAvatar(user?.id ?? null, null);
    setAvatar(null);
  };

  /** 只提交本 Tab 负责的键，留空表示不变 */
  const buildValues = (): WritableConfig => {
    const values: WritableConfig = { DATA_STORE: dataStore };
    if (url.trim()) values.SUPABASE_URL = url.trim();
    if (anonKey.trim()) values.SUPABASE_ANON_KEY = anonKey.trim();
    if (serviceKey.trim()) values.SUPABASE_SERVICE_ROLE_KEY = serviceKey.trim();
    if (webUrl.trim()) values.PUBLIC_WEB_URL = webUrl.trim();
    return values;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await api.saveConfig(buildValues());
      onSaved();
    } catch (err) {
      setError((err as Error).message || "保存失败");
      setBusy(false);
    }
  };

  const resetAll = async () => {
    if (!window.confirm("确定清除本机已保存的全部设置吗？(不会影响云端数据)")) return;
    setBusy(true);
    setError("");
    try {
      await api.saveConfig({
        DATA_STORE: "",
        SUPABASE_URL: "",
        SUPABASE_ANON_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        PUBLIC_WEB_URL: "",
      });
      // 本机模型条目同样按账号清除（运营方预置条目不可清除）；云端不可用就只清本机
      try {
        const client = store === "supabase" && user ? getSupabase() : null;
        await saveModelStore(
          user?.id ?? null,
          { profiles: [], defaultId: "", selectedId: "" },
          client
        );
      } catch {
        // 云端清除失败不阻塞"清除本机设置"
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message || "重置失败");
      setBusy(false);
    }
  };

  const cloudReady = dataStore === "supabase" && Boolean(url.trim() && anonKey.trim());

  return (
    <>
      <form onSubmit={save} className="settings-body">
        <div className="settings-group-title">账号</div>
        <div className="settings-account">
          <div className="settings-avatar">
            {avatar ? <img src={avatar} alt="头像" /> : <User size={22} />}
          </div>
          <div className="settings-account-info">
            <div className="settings-account-email" title={user?.email ?? ""}>
              {user?.email ?? "未登录（内存模式）"}
            </div>
            <div className="settings-account-meta">
              {bridgeKind === "desktop" ? "桌面端" : "网页端"} ·{" "}
              {store === "supabase" ? "云存储" : "内存模式（不持久化）"}
            </div>
            {user ? (
              <div className="settings-account-id" title={user.id}>
                ID: {user.id}
              </div>
            ) : null}
          </div>
          <div className="settings-avatar-actions">
            <button
              type="button"
              className="share-btn"
              onClick={() => avatarInputRef.current?.click()}
            >
              {avatar ? "更换头像" : "上传头像"}
            </button>
            {avatar ? (
              <button
                type="button"
                className="share-btn danger"
                onClick={removeAvatar}
              >
                移除头像
              </button>
            ) : null}
          </div>
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden-file-input"
          onChange={(e) => pickAvatar(e.target.files?.[0] ?? null)}
        />
        {avatarError ? <div className="auth-error">{avatarError}</div> : null}
        <div className="settings-hint">
          头像保存在本机（按账号隔离），不会上传到服务器。
        </div>
        {user ? (
          <button
            type="button"
            className="share-btn danger settings-logout"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            退出登录
          </button>
        ) : null}

        <div className="settings-group-title">外观</div>
        <div className="theme-segmented">
          {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`theme-segment ${themeMode === m ? "active" : ""}`}
              onClick={() => onThemeChange(m)}
            >
              {m === "light" ? (
                <Sun size={14} />
              ) : m === "dark" ? (
                <Moon size={14} />
              ) : (
                <Monitor size={14} />
              )}
              {THEME_LABELS[m]}
            </button>
          ))}
        </div>

        {config?.canEditInfra ? (
          <>
            <div className="settings-group-title">数据存储</div>
            <label className="settings-field">
              <span>存储模式</span>
              <select
                value={dataStore}
                onChange={(e) => setDataStore(e.target.value)}
              >
                <option value="supabase">
                  supabase · 云同步（需填写下方 URL / Anon Key）
                </option>
                <option value="memory">
                  memory · 仅内存（不持久化，适合演示）
                </option>
              </select>
            </label>
            {!cloudReady ? (
              <div className="settings-hint warn">
                云存储需同时填写 Supabase URL 与 Anon Key 才会生效。
              </div>
            ) : null}

            <div className="settings-group-title">
              Supabase（与网页版同一项目则数据互通）
            </div>
            <label className="settings-field">
              <span>Supabase URL</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
              />
            </label>
            <label className="settings-field">
              <span>Anon Key（公开值）</span>
              <input
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                placeholder="eyJhbGciOi…"
              />
            </label>
            <label className="settings-field">
              <span>Service Role Key（可选，仅“老数据认领”等系统操作使用）</span>
              <input
                type="password"
                value={serviceKey}
                onChange={(e) => setServiceKey(e.target.value)}
                placeholder="可选，不参与业务读写"
                autoComplete="off"
              />
            </label>

            <div className="settings-group-title">分享</div>
            <label className="settings-field">
              <span>分享站点地址（网页端部署地址，用于拼接分享链接）</span>
              <input
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                placeholder="https://your-site.com"
              />
            </label>
            <div className="settings-hint">
              桌面端没有网页地址，分享前需填写此地址，生成的链接才能在浏览器打开；
              需先在 Supabase 执行
              supabase/migrations/create_shared_conversations.sql。
            </div>
          </>
        ) : null}

        {error ? <div className="auth-error">{error}</div> : null}

        <div className="settings-group-title">关于</div>
        <div className="settings-foot-info">
          <div>
            DeekAI {config?.appVersion ?? ""} ·{" "}
            {config?.edition === "advanced"
              ? "自托管版（advanced）"
              : "发行版（release）"}
          </div>
          <div>配置来源：{config?.configSource ?? "未知"}</div>
          {config?.canEditInfra ? (
            <div className="mono">
              数据目录：{config?.userDataDir ?? "…"}（config.json / 会话缓存）
            </div>
          ) : (
            <div>
              本版本已内置后端与站点配置，无需填写；如需自托管（配置自己的
              Supabase 等），请设置 DEEKAI_EDITION=advanced 后启动。
            </div>
          )}
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className="settings-reset"
            onClick={resetAll}
            disabled={busy}
            title="清除本机保存的设置并回到未配置状态"
          >
            <Trash2 size={15} />
            清除本机设置
          </button>
          <span className="settings-actions-spacer" />
          <button type="button" className="settings-cancel" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="settings-save" disabled={busy}>
            <Save size={15} />
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </>
  );
}
