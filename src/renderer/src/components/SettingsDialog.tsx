import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { BridgeKind, PublicConfig } from "@shared/bridge-api";
import type { ThemeMode } from "../lib/theme";
import SettingsGeneralTab from "./settings/SettingsGeneralTab";
import SettingsModelsTab from "./settings/SettingsModelsTab";

/**
 * 应用设置弹窗（壳）：只负责标题、Tab 切换与销毁条件，内容交给各 Tab 组件。
 * 新增 Tab（例如以后的智能体 / MCP / Skill）只需往 TABS 里加一项 + 写一个组件，
 * 每个 Tab 各自负责自己的配置键，互不干扰（config-core 的 save 按传入的键增量写入）。
 */

const TABS = [
  { id: "general", label: "用户设置" },
  { id: "models", label: "模型设置" },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
  const [tab, setTab] = useState<TabId>("general");

  // 每次打开都回到第一个 Tab，避免上次停在某个编辑态
  useEffect(() => {
    if (open) setTab("general");
  }, [open]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div className="settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>应用设置</h2>
          <button className="settings-close" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`settings-tab ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "general" ? (
          <SettingsGeneralTab
            config={config}
            themeMode={themeMode}
            onThemeChange={onThemeChange}
            user={user}
            bridgeKind={bridgeKind}
            store={store}
            onLogout={onLogout}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <SettingsModelsTab
            userId={user?.id ?? null}
            serverProfiles={config?.serverModelProfiles ?? []}
            remote={store === "supabase"}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
