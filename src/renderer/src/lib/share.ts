import type { ChatMessage } from "@shared/attachments";
import type { Conversation } from "@shared/chat-types";
import { getSupabase } from "./supabase";

/**
 * 会话分享（只读链接）：
 * - 分享内容为创建时的快照，写入 Supabase 的 shared_conversations 表
 * - token 为 128bit 随机值，不可枚举；任何持有链接的人可只读查看
 * - 需要云存储（supabase）模式；memory 模式不可分享
 * - 表结构见 supabase/migrations/create_shared_conversations.sql
 */

const SHARE_KEY_PREFIX = "deekai:share:";

export interface ShareResult {
  token: string;
  url: string;
}

export interface SharedConversation {
  token: string;
  title: string;
  projectName: string | null;
  messages: ChatMessage[];
  createdAt: string | null;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 本机记录「会话 -> 分享 token」，用于再次打开弹窗时展示与撤销 */
export function getShareToken(conversationId: string): string | null {
  try {
    return localStorage.getItem(SHARE_KEY_PREFIX + conversationId);
  } catch {
    return null;
  }
}

function rememberShare(conversationId: string, token: string): void {
  try {
    localStorage.setItem(SHARE_KEY_PREFIX + conversationId, token);
  } catch {
    // 忽略写入失败
  }
}

function forgetShare(conversationId: string): void {
  try {
    localStorage.removeItem(SHARE_KEY_PREFIX + conversationId);
  } catch {
    // 忽略
  }
}

/** 拼接分享链接：优先使用配置的网页端地址，否则退回当前页面地址 */
export function buildShareUrl(
  token: string,
  publicWebUrl: string | null
): string {
  const configured = publicWebUrl?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}/#/share/${token}`;

  const origin = window.location.origin;
  if (origin && origin !== "null") return `${origin}/#/share/${token}`;
  // 桌面端 file:// 场景且未配置分享站点：仅返回相对 hash
  return `#/share/${token}`;
}

export async function createShare(
  conversation: Conversation,
  projectName: string | null,
  publicWebUrl: string | null
): Promise<ShareResult> {
  const client = getSupabase();
  const token = randomToken();

  const { error } = await client.from("shared_conversations").insert({
    token,
    title: conversation.title,
    project_name: projectName,
    messages: conversation.messages,
  });

  if (error) {
    throw new Error(`创建分享失败: ${error.message}`);
  }

  rememberShare(conversation.id, token);
  return { token, url: buildShareUrl(token, publicWebUrl) };
}

export async function revokeShare(
  conversationId: string,
  token: string
): Promise<void> {
  const client = getSupabase();
  const { error } = await client
    .from("shared_conversations")
    .delete()
    .eq("token", token);

  if (error) {
    throw new Error(`撤销分享失败: ${error.message}`);
  }
  forgetShare(conversationId);
}

export async function loadSharedConversation(
  token: string
): Promise<SharedConversation | null> {
  const client = getSupabase();
  const { data, error } = await client
    .from("shared_conversations")
    .select("token, title, project_name, messages, created_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    throw new Error(`读取分享失败: ${error.message}`);
  }
  if (!data) return null;

  const row = data as {
    token: string;
    title: string | null;
    project_name: string | null;
    messages: unknown;
    created_at: string | null;
  };

  return {
    token: row.token,
    title: row.title ?? "共享会话",
    projectName: row.project_name,
    messages: Array.isArray(row.messages)
      ? (row.messages as ChatMessage[])
      : [],
    createdAt: row.created_at,
  };
}
