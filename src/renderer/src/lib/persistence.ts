import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@shared/attachments";
import type { ChatState, Conversation, Project } from "@shared/chat-types";

/**
 * 存储层封装（与网页版 lib/persistence.ts 同源）：
 * 读写全部使用调用方传入的「用户级」Supabase 客户端
 * （anon key + 用户 access_token），数据库 RLS 按 auth.uid() 兜底隔离。
 *
 * 写入策略：**按字段增量**，不再整表替换。
 *
 * 这里维护一份「与云端一致」的内存基线，保存时只发真正变化的字段：
 *   - 只改标题 → 只 UPDATE title
 *   - 只挪分组 → 只 UPDATE project_id
 *   - 聊天     → 只 UPDATE 那一条会话的 messages
 *   - 本地删掉的会话/项目才 DELETE 对应行，绝不 DELETE 全表
 *
 * 这样多端同时使用时，「A 端改了个标题」不会把「B 端刚聊出来的消息」冲掉；
 * 老实现（DELETE 全部 + INSERT 全部）会把另一端所有新增数据清空。
 *
 * messages 另有一层**乐观锁**（`conversations.messages_rev`）：
 * 写入时带上「本端基于哪个版本」，若云端已被别处改过则不再盲写，
 * 能自动合并的自动合并，不能的交给用户裁决（见 saveChatState 的返回值）。
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
  messages_rev: number;
  sort_order: number;
}

/** 基线中的一条会话：ref 用于「引用没变就是没改」的快路径比较 */
interface ConversationBase {
  ref: Conversation;
  order: number;
  /** messages 的云端版本号（乐观锁基准） */
  rev: number;
  /** 该行已在别处被删除：本端不再尝试写它，避免反复冲突 */
  gone?: boolean;
}

/** 需要用户裁决的冲突：两端都改写了同一会话的消息，且无法自动合并 */
export interface ChatConflict {
  conversationId: string;
  title: string;
  /** 本端当前的版本 */
  mine: ChatMessage[];
  /** 云端的版本 */
  theirs: ChatMessage[];
}

/** 一次保存的结果，调用方需据此调整本地状态 */
export interface SaveOutcome {
  /** 已自动合并的会话：本地消息应替换成这里的内容 */
  merged: { conversationId: string; messages: ChatMessage[] }[];
  /** 待用户裁决的冲突（本端版本尚未写入云端） */
  conflicts: ChatConflict[];
}

const conversationBase = new Map<string, ConversationBase>();
const projectBase = new Map<string, { ref: Project }>();

/** 新会话的 sort_order 分配值（递减），使新会话稳定排在列表最前 */
let nextOrder = 0;

/** 自己写入后的一小段时间内忽略 Realtime 回传，避免每次保存都白拉一次全量 */
const SELF_WRITE_GRACE_MS = 1500;
let selfWriteUntil = 0;

/** 基线代数：每次 loadChatState 递增，用来丢弃「加载期间落地」的过期保存结果 */
let baselineGeneration = 0;
/** 是否有保存请求在飞行中（调用方据此避免用刚拉到的旧数据覆盖本地改动） */
let saving = false;

export function isSaving(): boolean {
  return saving;
}

/** messages 未变化时不产生任何写入；引用相同（React 常见的复用）走快路径 */
function sameMessages(
  a: Conversation["messages"],
  b: Conversation["messages"]
): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 把一条消息规范化成与键顺序无关的字符串。
 * 必须这么做：jsonb 会按自己的规则重排对象键，直接从云端读回来的对象
 * 与本端构造的对象键顺序可能不同，直接比较原对象会误判成「内容变了」。
 */
function messageKey(message: ChatMessage): string {
  return JSON.stringify([message.role, message.content, message.attachments ?? null]);
}

/** 另一端是否只是在本端基线之后「接着聊」——这种情况可以安全地自动合并 */
function isAppendOnly(base: ChatMessage[], remote: ChatMessage[]): boolean {
  if (remote.length < base.length) return false;
  for (let i = 0; i < base.length; i += 1) {
    if (messageKey(base[i]) !== messageKey(remote[i])) return false;
  }
  return true;
}

/**
 * 尝试自动合并另一端与本端的消息改动，返回 null 表示需要用户裁决。
 *
 * 合并规则（前提：基线那部分没被另一端改写，且本端没有减少消息）：
 *   另一端的全部消息 + 本端新增的消息；
 *   若本端改写了基线里的最后一条（通常是正在流式输出的助手回复），
 *   用本端那份覆盖回去——否则会用云端较早的版本把回答冲掉。
 */
function mergeMessages(
  pending: PendingPatch,
  remote: ChatMessage[]
): ChatMessage[] | null {
  const base = pending.baseMessages;
  const local = pending.conversation.messages;

  // 本端消息变少说明做过删除 / 重新生成，语义无法自动对齐
  if (local.length < base.length) return null;
  if (!isAppendOnly(base, remote)) return null;

  const merged = [...remote, ...local.slice(base.length)];

  if (base.length > 0) {
    const lastIndex = base.length - 1;
    const localLast = local[lastIndex];
    if (localLast && messageKey(localLast) !== messageKey(base[lastIndex])) {
      merged[lastIndex] = localLast;
    }
  }

  return merged;
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
      .select("id, project_id, title, messages, messages_rev, sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  if (projectsRes.error) {
    throw new Error(`读取项目失败: ${projectsRes.error.message}`);
  }
  if (conversationsRes.error) {
    throw new Error(`读取会话失败: ${conversationsRes.error.message}`);
  }

  const projectRows = (projectsRes.data as ProjectRow[] | null) ?? [];
  const conversationRows =
    (conversationsRes.data as ConversationRow[] | null) ?? [];

  const projects: Project[] = projectRows.map(({ id, name }) => ({ id, name }));
  const conversations: Conversation[] = conversationRows.map((row) => ({
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    messages: Array.isArray(row.messages) ? row.messages : [],
  }));

  // 重建基线：刚读到的这份就是「与云端一致」的状态
  baselineGeneration += 1;
  projectBase.clear();
  conversationBase.clear();
  let minOrder = 0;
  projects.forEach((project) => projectBase.set(project.id, { ref: project }));
  conversations.forEach((conversation, index) => {
    const row = conversationRows[index];
    conversationBase.set(conversation.id, {
      ref: conversation,
      order: row.sort_order,
      rev: row.messages_rev ?? 0,
    });
    minOrder = Math.min(minOrder, row.sort_order);
  });
  nextOrder = minOrder;

  return { projects, conversations };
}

export async function saveChatState(
  state: ChatState,
  client: SupabaseClient
): Promise<SaveOutcome> {
  // 记住进入时的基线代数：若期间发生了一次云端拉取，本次结果就不能再用来推进基线
  const generation = baselineGeneration;
  selfWriteUntil = Date.now() + SELF_WRITE_GRACE_MS;
  saving = true;

  try {
    return await writeDiff(state, client, generation);
  } finally {
    saving = false;
  }
}

/** 一条会话待发的改动 */
interface PendingPatch {
  /** 只含真正变化的列 */
  patch: Record<string, unknown>;
  /** 变更后的完整会话 */
  conversation: Conversation;
  /** 本端基线里的 messages（自动合并的三方基准） */
  baseMessages: ChatMessage[];
  /** 本端基线里的 messages 版本号 */
  baseRev: number;
  /** 本次是否动了 messages（决定要不要走乐观锁） */
  messagesChanged: boolean;
}

async function writeDiff(
  state: ChatState,
  client: SupabaseClient,
  generation: number
): Promise<SaveOutcome> {
  // ---- 1. 与基线比对，算出真正需要发的写入 ----
  const localConversationIds = new Set(state.conversations.map((c) => c.id));
  const localProjectIds = new Set(state.projects.map((p) => p.id));

  const deletedConversationIds = [...conversationBase.keys()].filter(
    (id) => !localConversationIds.has(id)
  );
  const deletedProjectIds = [...projectBase.keys()].filter(
    (id) => !localProjectIds.has(id)
  );

  const conversationInserts: ConversationRow[] = [];
  const conversationPatches = new Map<string, PendingPatch>();
  const nextConversationBase = new Map<string, ConversationBase>();

  for (const conversation of state.conversations) {
    const base = conversationBase.get(conversation.id);

    if (!base) {
      // 本地新建：整行插入，sort_order 取递减序号以便排在列表最前
      nextOrder -= 1;
      conversationInserts.push({
        id: conversation.id,
        project_id: conversation.projectId,
        title: conversation.title,
        messages: conversation.messages,
        messages_rev: 0,
        sort_order: nextOrder,
      });
      nextConversationBase.set(conversation.id, {
        ref: conversation,
        order: nextOrder,
        rev: 0,
      });
      continue;
    }

    if (base.gone) {
      // 云端已没有这一行：保持原样，不再尝试写它
      nextConversationBase.set(conversation.id, base);
      continue;
    }

    nextConversationBase.set(conversation.id, {
      ref: conversation,
      order: base.order,
      rev: base.rev,
    });

    // 引用没变 → 这个对象没被改过（React 只重建改动过的那条）
    if (base.ref === conversation) continue;

    const patch: Record<string, unknown> = {};
    if (base.ref.title !== conversation.title) {
      patch.title = conversation.title;
    }
    if (base.ref.projectId !== conversation.projectId) {
      patch.project_id = conversation.projectId;
    }
    const messagesChanged = !sameMessages(base.ref.messages, conversation.messages);
    if (messagesChanged) {
      patch.messages = conversation.messages;
    }
    if (Object.keys(patch).length > 0) {
      conversationPatches.set(conversation.id, {
        patch,
        conversation,
        baseMessages: base.ref.messages,
        baseRev: base.rev,
        messagesChanged,
      });
    }
  }

  const projectInserts: ProjectRow[] = [];
  const projectPatches = new Map<string, { name: string }>();
  const nextProjectBase = new Map<string, { ref: Project }>();

  state.projects.forEach((project, index) => {
    const base = projectBase.get(project.id);
    nextProjectBase.set(project.id, { ref: project });
    if (!base) {
      projectInserts.push({ id: project.id, name: project.name, sort_order: index });
    } else if (base.ref.name !== project.name) {
      projectPatches.set(project.id, { name: project.name });
    }
  });

  // ---- 2. 按外键依赖顺序落库 ----
  // 先删会话（腾开对项目的引用），再写项目，最后写会话并清理项目
  if (deletedConversationIds.length > 0) {
    const { error } = await client
      .from("conversations")
      .delete()
      .in("id", deletedConversationIds);
    if (error) {
      throw new Error(`删除会话失败: ${error.message}`);
    }
  }

  if (projectInserts.length > 0) {
    const { error } = await client.from("projects").insert(projectInserts);
    if (error) {
      throw new Error(`写入项目失败: ${error.message}`);
    }
  }

  await Promise.all(
    [...projectPatches].map(async ([id, patch]) => {
      const { error } = await client.from("projects").update(patch).eq("id", id);
      if (error) {
        throw new Error(`更新项目失败: ${error.message}`);
      }
    })
  );

  if (conversationInserts.length > 0) {
    const { error } = await client.from("conversations").insert(conversationInserts);
    if (error) {
      throw new Error(`写入会话失败: ${error.message}`);
    }
  }

  const mergedResults: SaveOutcome["merged"] = [];
  const conflicts: ChatConflict[] = [];

  await Promise.all(
    [...conversationPatches].map(async ([id, pending]) => {
      if (!pending.messagesChanged) {
        // 只改了标题 / 分组：后写赢即可，不涉及内容丢失
        const { error } = await client
          .from("conversations")
          .update(pending.patch)
          .eq("id", id);
        if (error) {
          throw new Error(`更新会话失败: ${error.message}`);
        }
        return;
      }

      // 乐观锁：只有云端版本仍是本端基线版本时才写
      const { data, error } = await client
        .from("conversations")
        .update({ ...pending.patch, messages_rev: pending.baseRev + 1 })
        .eq("id", id)
        .eq("messages_rev", pending.baseRev)
        .select("id");
      if (error) {
        throw new Error(`更新会话失败: ${error.message}`);
      }
      if (data && data.length > 0) {
        // 写入成功：基线必须跟着推进到新版本，
        // 否则下一次保存会拿着旧版本号去比对，被误判成「另一端改过了」
        const current = nextConversationBase.get(id);
        if (current) {
          nextConversationBase.set(id, { ...current, rev: pending.baseRev + 1 });
        }
        return;
      }

      // 版本对不上：云端在别处被改过。
      // 先把与消息内容无关的列（标题 / 分组）写掉，免得它们被冲突一起搁置。
      const restPatch: Record<string, unknown> = { ...pending.patch };
      delete restPatch.messages;
      if (Object.keys(restPatch).length > 0) {
        const { error: restError } = await client
          .from("conversations")
          .update(restPatch)
          .eq("id", id);
        if (restError) {
          throw new Error(`更新会话失败: ${restError.message}`);
        }
      }

      const { data: remote, error: readError } = await client
        .from("conversations")
        .select("messages, messages_rev")
        .eq("id", id)
        .maybeSingle();
      if (readError) {
        throw new Error(`读取云端版本失败: ${readError.message}`);
      }

      if (!remote) {
        // 这一行已经在别处被删掉了：标记后不再尝试写它，避免反复冲突
        const current = nextConversationBase.get(id);
        if (current) {
          nextConversationBase.set(id, { ...current, gone: true });
        }
        return;
      }

      const remoteMessages: ChatMessage[] = Array.isArray(remote.messages)
        ? (remote.messages as ChatMessage[])
        : [];

      // 另一端只是在本端基线之后接着聊 → 自动合并：云端消息 + 本端新增，两边都不丢
      const merged = mergeMessages(pending, remoteMessages);
      if (merged) {
        const { data: applied, error: applyError } = await client
          .from("conversations")
          .update({ messages: merged, messages_rev: remote.messages_rev + 1 })
          .eq("id", id)
          .eq("messages_rev", remote.messages_rev)
          .select("id");
        if (applyError) {
          throw new Error(`合并写入失败: ${applyError.message}`);
        }
        if (applied && applied.length > 0) {
          const current = nextConversationBase.get(id);
          // 基线按「合并后」推进；调用方会把本地消息换成 merged，因此不会重复写
          nextConversationBase.set(id, {
            ref: { ...pending.conversation, messages: merged },
            order: current?.order ?? 0,
            rev: remote.messages_rev + 1,
          });
          mergedResults.push({ conversationId: id, messages: merged });
          return;
        }
        // 又被抢先改了一次：降级为交给用户裁决
      }

      // 历史消息被改写（重新生成 / 删除等），无法自动合并 → 本端先不写，等用户裁决
      conflicts.push({
        conversationId: id,
        title: pending.conversation.title,
        mine: pending.conversation.messages,
        theirs: remoteMessages,
      });
    })
  );

  if (deletedProjectIds.length > 0) {
    // 云端可能还有别端新建、仍指向这些项目的会话，先摘掉归属再删，避免外键报错
    const { error: detachError } = await client
      .from("conversations")
      .update({ project_id: null })
      .in("project_id", deletedProjectIds);
    if (detachError) {
      throw new Error(`解除分组归属失败: ${detachError.message}`);
    }

    const { error } = await client
      .from("projects")
      .delete()
      .in("id", deletedProjectIds);
    if (error) {
      throw new Error(`删除项目失败: ${error.message}`);
    }
  }

  // ---- 3. 全部成功后才推进基线（失败则下次保存重试）----
  // 若期间发生过一次云端拉取，基线已由那次拉取重建，这里保持不动
  if (generation !== baselineGeneration) {
    return { merged: mergedResults, conflicts };
  }

  conversationBase.clear();
  for (const [id, base] of nextConversationBase) {
    conversationBase.set(id, base);
  }
  projectBase.clear();
  for (const [id, base] of nextProjectBase) {
    projectBase.set(id, base);
  }

  return { merged: mergedResults, conflicts };
}

/**
 * 冲突裁决：用户选择「保留我这边的」，把本端消息强制写回云端。
 *
 * 重新读一次云端版本号再写，因此不会再撞上乐观锁条件；
 * 同时把基线对齐到写入后的版本，避免下一次保存又被判成冲突。
 */
export async function forceSaveConversation(
  conversationId: string,
  messages: ChatMessage[],
  client: SupabaseClient
): Promise<void> {
  const { data: remote, error: readError } = await client
    .from("conversations")
    .select("messages_rev")
    .eq("id", conversationId)
    .maybeSingle();
  if (readError) {
    throw new Error(`读取云端版本失败: ${readError.message}`);
  }

  const rev = (((remote?.messages_rev as number | undefined) ?? 0) + 1);
  const { error } = await client
    .from("conversations")
    .update({ messages, messages_rev: rev })
    .eq("id", conversationId);
  if (error) {
    throw new Error(`写入会话失败: ${error.message}`);
  }

  selfWriteUntil = Date.now() + SELF_WRITE_GRACE_MS;

  const base = conversationBase.get(conversationId);
  if (base) {
    conversationBase.set(conversationId, {
      ...base,
      ref: { ...base.ref, messages },
      rev,
    });
  }
}

/**
 * 订阅云端变更（Supabase Realtime）：任意端写入后通知调用方拉取最新数据。
 *
 * 按事件类型区分：
 *   - 自己不感兴趣的信号（重连、订阅成功等）不处理
 *   - 处于自我写入抑制窗口内的事件忽略：那是刚才自己写出来的，本地已是最新
 *   - 其余事件做 400ms 防抖后合并成一次回调（一次保存可能产生多条事件）
 */
export function subscribeChatChanges(
  client: SupabaseClient,
  onChange: () => void
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (Date.now() < selfWriteUntil) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 400);
  };

  const channel = client
    .channel("deekai-chat-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      schedule
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "projects" },
      schedule
    )
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    client.removeChannel(channel);
  };
}
