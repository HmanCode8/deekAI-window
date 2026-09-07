import type { ChatMessage, UploadedAttachment } from "./attachments";
import type { StoreMode } from "./chat-types";

// 主进程 <-> 渲染进程 桥接层类型定义（与网页版 lib/auth.ts 的错误文案同源）

/** 渲染进程可见的公开配置（不含 DeepSeek Key / service_role 等敏感值） */
export interface PublicConfig {
  /** 实际生效的存储模式 */
  store: StoreMode;
  /** Supabase 是否已配置完整（URL + anon key 齐全） */
  supabaseConfigured: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** DeepSeek API Key 是否已配置 */
  deepseekConfigured: boolean;
  /** 模型兜底 */
  model: string | null;
  /** 配置来源说明：env 文件 / 应用设置 */
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
  DEEPSEEK_API_KEY?: string;
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

export interface DeekaiBridge {
  getConfig(): Promise<PublicConfig>;
  saveConfig(values: WritableConfig): Promise<{ ok: true }>;
  /** 发起一次流式对话，主进程解析 SSE 后按 id 推送事件 */
  chatStart(payload: ChatStartPayload): Promise<void>;
  chatAbort(id: string): void;
  /** 注册流式事件监听（重复注册会替换旧的，返回移除方法） */
  onChatEvent(cb: (event: ChatStreamEvent) => void): () => void;
  uploadFile(input: UploadInput): Promise<UploadedAttachment>;
  /** 老数据认领（主进程使用 service role，一次性的系统操作） */
  adoptOrphans(token: string, userId: string): Promise<{ adopted: boolean }>;
  openExternal(url: string): void;
  clipboardWrite(text: string): Promise<void>;
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
