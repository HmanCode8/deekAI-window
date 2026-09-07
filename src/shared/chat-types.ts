import type { ChatMessage } from "./attachments";

// 会话/项目/状态类型（前后端共享，与网页版 lib/chat-types.ts 同源）
export interface Project {
  id: string;
  name: string;
}

export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  messages: ChatMessage[];
}

export interface ChatState {
  projects: Project[];
  conversations: Conversation[];
}

export type StoreMode = "memory" | "supabase";
