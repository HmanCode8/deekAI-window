import { useEffect, useRef, useState, type FormEvent } from "react";
import { Monitor, Moon, Save, Sun, Trash2, User, X } from "lucide-react";
import type {
  BridgeKind,
  PublicConfig,
  WritableConfig,
} from "@shared/bridge-api";
import { THEME_LABELS, type ThemeMode } from "../lib/theme";
import { fileToAvatarDataUrl, loadAvatar, saveAvatar } from "../lib/profile";
import * as api from "../lib/api";

interface SettingsDialogProps {
  open: boolean;
  config: PublicConfig | null;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  /** 当前登录用户；内存模式为 null */
  user: { id: string; email: string } | null;
  /** 运行形态与存储模式（账号分区展示用） */
  bridgeKind: BridgeKind;
  store: "memory" | "supabase";
  onLogout: () => void;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 应用设置弹窗：配置写入主进程 userData/config.json（优先级高于 .env 文件）。
 * 敏感值（DeepSeek Key 等）不会回显；输入留空表示“保持不变”。
 */
export default function SettingsDialog({
  open,
  config,
  themeMode,
  onThemeChange,
  user,
  bridgeKind,
  store,
  onLogout,
  onClose,
  onSaved,
}: SettingsDialogProps) {
  const [dataStore, setDataStore] = useState("supabase");
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDataStore(config?.store === "memory" ? "memory" : "supabase");
    setUrl(config?.supabaseUrl ?? "");
    setAnonKey(config?.supabaseAnonKey ?? "");
    setServiceKey("");
    setApiKey("");
    setModel(config?.model ?? "");
    setBaseUrl(config?.modelBaseUrl ?? "");
    setWebUrl(config?.publicWebUrl ?? "");
    setAvatar(loadAvatar(user?.id ?? null));
    setAvatarError("");
    setError("");
    setBusy(false);
  }, [open, config, user?.id]);

  if (!open) return null;

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

  const buildValues = (): WritableConfig => {
    const values: WritableConfig = { DATA_STORE: dataStore };
    if (url.trim()) values.SUPABASE_URL = url.trim();
    if (anonKey.trim()) values.SUPABASE_ANON_KEY = anonKey.trim();
    if (serviceKey.trim()) values.SUPABASE_SERVICE_ROLE_KEY = serviceKey.trim();
    if (apiKey.trim()) values.DEEPSEEK_API_KEY = apiKey.trim();
    if (baseUrl.trim()) values.DEEPSEEK_BASE_URL = baseUrl.trim();
    if (model.trim()) values.DEEPSEEK_MODEL = model.trim();
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
        DEEPSEEK_API_KEY: "",
        DEEPSEEK_BASE_URL: "",
        DEEPSEEK_MODEL: "",
        PUBLIC_WEB_URL: "",
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message || "重置失败");
      setBusy(false);
    }
  };

  const cloudReady = dataStore === "supabase" && Boolean(url.trim() && anonKey.trim());

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div
        className="settings-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2>应用设置</h2>
          <button className="settings-close" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={save} className="settings-body">
          <div className="settings-group-title">账号</div>
          <div className="settings-account">
            <div className="settings-avatar">
              {avatar ? (
                <img src={avatar} alt="头像" />
              ) : (
                <User size={22} />
              )}
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

          <div className="settings-group-title">我的模型</div>
          <label className="settings-field">
            <span>API Base URL（OpenAI 兼容服务地址）</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label className="settings-field">
            <span>
              API Key
              {config?.deepseekConfigured ? (
                <em className="settings-tag ok">已配置</em>
              ) : (
                <em className="settings-tag">未配置</em>
              )}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                config?.deepseekConfigured
                  ? "已配置 · 留空保持不变"
                  : "sk-…"
              }
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>默认模型</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat"
            />
          </label>
          <div className="settings-hint">
            可填写任意 OpenAI 兼容服务的地址与 Key（自带 Key 模式）。图片附件目前仅
            DeepSeek 官方地址支持上传，其它服务请使用文档类附件。
          </div>

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
            <select value={dataStore} onChange={(e) => setDataStore(e.target.value)}>
              <option value="supabase">supabase · 云同步（需填写下方 URL / Anon Key）</option>
              <option value="memory">memory · 仅内存（不持久化，适合演示）</option>
            </select>
          </label>
          {!cloudReady ? (
            <div className="settings-hint warn">
              云存储需同时填写 Supabase URL 与 Anon Key 才会生效。
            </div>
          ) : null}

          <div className="settings-group-title">Supabase（与网页版同一项目则数据互通）</div>
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
              {config?.edition === "advanced" ? "自托管版（advanced）" : "发行版（release）"}
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
      </div>
    </div>
  );
}
