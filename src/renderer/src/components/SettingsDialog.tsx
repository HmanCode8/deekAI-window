import { useEffect, useState, type FormEvent } from "react";
import { Save, Trash2, X } from "lucide-react";
import type { PublicConfig, WritableConfig } from "@shared/bridge-api";
import * as api from "../lib/api";

interface SettingsDialogProps {
  open: boolean;
  config: PublicConfig | null;
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
  onClose,
  onSaved,
}: SettingsDialogProps) {
  const [dataStore, setDataStore] = useState("supabase");
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDataStore(config?.store === "memory" ? "memory" : "supabase");
    setUrl(config?.supabaseUrl ?? "");
    setAnonKey(config?.supabaseAnonKey ?? "");
    setServiceKey("");
    setApiKey("");
    setModel(config?.model ?? "");
    setError("");
    setBusy(false);
  }, [open, config]);

  if (!open) return null;

  const buildValues = (): WritableConfig => {
    const values: WritableConfig = { DATA_STORE: dataStore };
    if (url.trim()) values.SUPABASE_URL = url.trim();
    if (anonKey.trim()) values.SUPABASE_ANON_KEY = anonKey.trim();
    if (serviceKey.trim()) values.SUPABASE_SERVICE_ROLE_KEY = serviceKey.trim();
    if (apiKey.trim()) values.DEEPSEEK_API_KEY = apiKey.trim();
    if (model.trim()) values.DEEPSEEK_MODEL = model.trim();
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
        DEEPSEEK_MODEL: "",
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

          <div className="settings-group-title">DeepSeek</div>
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
                config?.deepseekConfigured ? "已配置 · 留空保持不变" : "sk-…"
              }
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>模型兜底（选择器未覆盖时的默认模型）</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-v4-flash"
            />
          </label>

          {error ? <div className="auth-error">{error}</div> : null}

          <div className="settings-foot-info">
            <div>当前配置来源：{config?.configSource ?? "未知"}</div>
            <div className="mono">
              数据目录：{config?.userDataDir ?? "…"}（config.json / 会话缓存）
            </div>
            <div>也支持在应用目录放置 .env 提供配置（参见 .env.example）。</div>
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
