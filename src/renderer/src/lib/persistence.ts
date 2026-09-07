import type {
  SupabaseClient,
} from "@supabase/supabase-js";
import type { ChatState } from "@shared/chat-types";

/**
 * 存储层封装（与网页版 lib/persistence.ts 同源）：
 * 读写全部使用调用方传入的「用户级」Supabase 客户端
 * （anon key + 用户 access_token），数据库 RLS 按 auth.uid() 兜底隔离。
 */

interface ProjectRow {
  id: string;
  name: string;
  sort_order: number;
}

interface ConversationRow {
  id: string;
  project_id: string | null;
  title: string;
  messages: unknown;
  sort_order: number;
}

export async function loadChatState(
  client: SupabaseClient
): Promise<ChatState> {
  const [projectsRes, conversationsRes] = await Promise.all([
    client
      .from("projects")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true }),
    client
      .from("conversations")
      .select("id, project_id, title, messages, sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  if (projectsRes.error) {
    throw new Error(`读取项目失败: ${projectsRes.error.message}`);
  }
  if (conversationsRes.error) {
    throw new Error(`读取会话失败: ${conversationsRes.error.message}`);
  }

  const projects =
    (projectsRes.data as ProjectRow[] | null)?.map(({ id, name }) => ({
      id,
      name,
    })) ?? [];

  const conversations =
    (conversationsRes.data as ConversationRow[] | null)?.map((row) => ({
      id: row.id,
      title: row.title,
      projectId: row.project_id,
      messages: Array.isArray(row.messages) ? row.messages : [],
    })) ?? [];

  return { projects, conversations };
}

export async function saveChatState(
  state: ChatState,
  client: SupabaseClient
): Promise<void> {
  // 以数组顺序作为展示顺序（sort_order），整表替换保证一致性。
  // user_id 不在此写入：新行由数据库默认 auth.uid() 自动归属当前登录用户。
  const projectRows = state.projects.map((p, index) => ({
    id: p.id,
    name: p.name,
    sort_order: index,
  }));

  const conversationRows = state.conversations.map((c, index) => ({
    id: c.id,
    project_id: c.projectId,
    title: c.title,
    messages: c.messages,
    sort_order: index,
  }));

  // 先清空本用户的会话，再清空本用户的项目（RLS 保证只影响自己的行）
  const clearConversations = await client
    .from("conversations")
    .delete()
    .neq("id", "");
  if (clearConversations.error) {
    throw new Error(`清空会话失败: ${clearConversations.error.message}`);
  }

  const clearProjects = await client.from("projects").delete().neq("id", "");
  if (clearProjects.error) {
    throw new Error(`清空项目失败: ${clearProjects.error.message}`);
  }

  if (projectRows.length > 0) {
    const insertProjects = await client.from("projects").insert(projectRows);
    if (insertProjects.error) {
      throw new Error(`写入项目失败: ${insertProjects.error.message}`);
    }
  }

  if (conversationRows.length > 0) {
    const insertConversations = await client
      .from("conversations")
      .insert(conversationRows);
    if (insertConversations.error) {
      throw new Error(`写入会话失败: ${insertConversations.error.message}`);
    }
  }
}
