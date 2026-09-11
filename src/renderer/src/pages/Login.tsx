import { useState, type FormEvent } from "react";
import { Settings } from "lucide-react";
import { humanizeAuthError } from "@shared/bridge-api";
import { getSupabase } from "../lib/supabase";

type Mode = "login" | "signup";

/**
 * 登录 / 注册页（复用网页版 UI，验证逻辑直接走 Supabase Auth：
 * 注册若开启邮件验证会提示去邮箱确认，确认后回应用登录即可。）
 */
export default function Login({
  onOpenSettings,
  expiredNotice,
}: {
  onOpenSettings: () => void;
  /** 会话过期后由 App 传入的提示（空闲超时 / 累计上限） */
  expiredNotice?: string;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setNotice("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(true);

    const emailText = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailText)) {
      setError("请输入正确的邮箱地址");
      setBusy(false);
      return;
    }
    if (password.length < 6) {
      setError("密码至少需要 6 位");
      setBusy(false);
      return;
    }

    try {
      const client = getSupabase();
      const result =
        mode === "login"
          ? await client.auth.signInWithPassword({
              email: emailText,
              password,
            })
          : await client.auth.signUp({
              email: emailText,
              password,
            });

      const { data, error: authError } = result;

      // 注册且开启邮箱验证：不会直接产生会话，引导用户查收验证邮件
      if (mode === "signup" && !data.session) {
        setNotice("注册成功！请前往邮箱点击验证链接后回到应用登录。");
        setMode("login");
        return;
      }

      if (authError) {
        setError(
          humanizeAuthError(authError.code ?? "", authError.message || "操作失败")
        );
        return;
      }
      // 登录成功后由 App 的会话订阅驱动进入聊天界面
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <button className="auth-settings-btn" onClick={onOpenSettings} title="应用设置">
        <Settings size={16} />
        设置
      </button>

      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">DeekAI</h1>
        <p className="auth-subtitle">
          {mode === "login" ? "登录你的账号" : "创建新账号"}
          <span className="auth-subtitle-sub">（云存储由 Supabase 提供，与网页版数据互通）</span>
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            注册
          </button>
        </div>

        <label className="auth-field">
          <span>邮箱</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="至少 6 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {expiredNotice && !notice ? (
          <div className="auth-notice">{expiredNotice}</div>
        ) : null}
        {error ? <div className="auth-error">{error}</div> : null}
        {notice ? <div className="auth-notice">{notice}</div> : null}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "请稍候…" : mode === "login" ? "登录" : "注册"}
        </button>
      </form>
    </div>
  );
}
