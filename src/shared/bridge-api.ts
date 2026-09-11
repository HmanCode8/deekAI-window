import type { ChatMessage, UploadedAttachment } from "./attachments";
import type { StoreMode } from "./chat-types";

// 主进程 <-> 渲染进程 桥接层类型定义（与网页版 lib/auth.ts 的错误文案同源）

/** 发行版本：release = 面向普通用户（内部配置隐藏）；advanced = 自托管/开发者版 */
export type Edition = "release" | "advanced";

/** 渲染进程可见的公开配置（不含 DeepSeek Key / service_role 等敏感值） */
export interface PublicConfig {
  /** 实际生效的存储模式 */
  store: StoreMode;
  /** Supabase 是否已配置完整（URL + anon key 齐全） */
  supabaseConfigured: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** 模型 API Key 是否已配置（发行内置或用户自带） */
  deepseekConfigured: boolean;
  /** 默认模型 */
  model: string | null;
  /** 模型服务 Base URL（非敏感，用于设置页回显） */
  modelBaseUrl: string | null;
  /** 分享站点地址（网页端部署地址，用于拼接分享链接） */
  publicWebUrl: string | null;
  /** 当前发行版本 */
  edition: Edition;
  /** 是否允许修改后端基础设施（仅 advanced 为 true） */
  canEditInfra: boolean;
  /** 配置来源说明 */
  configSource: string;
  appVersion: string;
  userDataDir: string;
}

/** 保存设置时允许写入的键（其余一律拒绝） */
export interface WritableConfig {
  DATA_STORE?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PUBLIC_WEB_URL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

/** 流式对话事件（主进程 -> 渲染进程） */
export type ChatStreamEvent =
  | { id: string; type: "delta"; text: string }
  | { id: string; type: "done" }
  | { id: string; type: "error"; message: string }
  | { id: string; type: "stopped" };

export interface ChatStartPayload {
  id: string;
  messages: ChatMessage[];
  model?: string;
}

export interface UploadInput {
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
}

export interface ExportPdfInput {
  /** 建议文件名（含 .pdf） */
  fileName: string;
  /** 完整 HTML 文档（打印样式已内联） */
  html: string;
}

export interface ExportPdfResult {
  saved: boolean;
  path?: string;
}

/** 运行形态：desktop = Electron 壳；web = 浏览器 + 网页后端 */
export type BridgeKind = "desktop" | "web";

/** 从网页唤起桌面端时携带的参数（自定义协议 deekai://open） */
export interface DesktopDeeplink {
  conversationId: string | null;
  draft: string | null;
}

/** 自定义协议名（网页端 deekai://open?... ↔ 桌面端注册同一协议） */
export const DESKTOP_PROTOCOL = "deekai";
export const DEEPLINK_MAX_DRAFT = 2000;

export interface DeekaiBridge {
  /** 当前运行形态，UI 据此决定是否展示“在桌面端打开”等入口 */
  kind: BridgeKind;
  getConfig(): Promise<PublicConfig>;
  saveConfig(values: WritableConfig): Promise<{ ok: true }>;
  /** 发起一次流式对话，后端解析 SSE 后按 id 推送事件 */
  chatStart(payload: ChatStartPayload): Promise<void>;
  chatAbort(id: string): void;
  /** 注册流式事件监听（重复注册会替换旧的） */
  onChatEvent(cb: (event: ChatStreamEvent) => void): () => void;
  uploadFile(input: UploadInput): Promise<UploadedAttachment>;
  /** 老数据认领（使用 service role，一次性的系统操作） */
  adoptOrphans(token: string, userId: string): Promise<{ adopted: boolean }>;
  openExternal(url: string): void;
  clipboardWrite(text: string): Promise<void>;
  /** 网页端：跳转 deekai:// 唤起桌面应用；桌面端：聚焦自身（no-op） */
  openDesktop(payload: DesktopDeeplink): void;
  /** 桌面端：接收协议唤起事件；网页端：no-op */
  onDeeplink(cb: (link: DesktopDeeplink) => void): () => void;
  /** 桌面端：取出启动时缓存、尚未消费的协议参数 */
  getPendingDeeplink(): Promise<DesktopDeeplink | null>;
  /** 导出 PDF（桌面端落盘；网页端打开打印对话框由用户另存为 PDF） */
  exportPdf(input: ExportPdfInput): Promise<ExportPdfResult>;
}

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "邮箱或密码错误",
  email_not_confirmed: "邮箱尚未验证，请先查收并点击验证邮件",
  user_already_exists: "该邮箱已注册，请直接登录",
  weak_password: "密码强度不足，请使用至少 6 位字符",
  over_email_send_rate_limit: "验证邮件发送过于频繁，请稍后再试",
};

export function humanizeAuthError(code: string, fallback: string): string {
  return AUTH_ERROR_MESSAGES[code] ?? fallback;
}
