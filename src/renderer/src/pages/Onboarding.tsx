import { FolderPlus, Play, Settings, Sparkles } from "lucide-react";

/**
 * 首次启动引导：Supabase 未配置时的入口选择。
 * 配置方式灵活：可直接在本机应用设置填写，也可在应用目录放 .env / config.json。
 */
export default function Onboarding({
  onOpenSettings,
  onContinueMemory,
}: {
  onOpenSettings: () => void;
  onContinueMemory: () => void;
}) {
  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-logo">
          <Sparkles size={26} />
        </div>
        <h1 className="onboarding-title">DeekAI 桌面版</h1>
        <p className="onboarding-desc">
          基于 DeepSeek 的 AI 聊天助手。要启用<strong>账号登录与云端持久化</strong>
          （与网页版同一套 Supabase、数据互通），需要先配置云存储信息。
        </p>

        <div className="onboarding-features">
          <div className="onboarding-feature">
            <span className="onboarding-feature-icon">
              <Settings size={16} />
            </span>
            <div>
              <b>应用内设置</b>
              <p>填写 Supabase URL / Anon Key / DeepSeek Key，保存在本机，密钥不打包进安装包。</p>
            </div>
          </div>
          <div className="onboarding-feature">
            <span className="onboarding-feature-icon">
              <FolderPlus size={16} />
            </span>
            <div>
              <b>配置文件（可选）</b>
              <p>也支持在应用目录放置 .env（含 DEEPSEEK_API_KEY / SUPABASE_* 等，参见 .env.example）。</p>
            </div>
          </div>
        </div>

        <div className="onboarding-actions">
          <button className="auth-submit onboarding-primary" onClick={onOpenSettings}>
            <Settings size={16} />
            去设置并配置
          </button>
          <button
            className="onboarding-secondary"
            onClick={onContinueMemory}
          >
            <Play size={15} />
            先以内存模式试用（关闭后数据不保留）
          </button>
        </div>
      </div>
    </div>
  );
}
