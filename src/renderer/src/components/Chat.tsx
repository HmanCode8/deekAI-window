import { useEffect, useRef, useState, type DragEvent } from "react";
import Markdown from "./Markdown";
import ShareDialog from "./ShareDialog";
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Database,
  FileDown,
  FolderPlus,
  Menu,
  MessageSquare,
  Monitor,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import type { ChatMessage, UploadedAttachment } from "@shared/attachments";
import { isSupportedImage } from "@shared/attachments";
import type { ChatState, Conversation, Project } from "@shared/chat-types";
import type { DesktopDeeplink, PublicModelProfile } from "@shared/bridge-api";
import {
  buildConversationHtml,
  buildMessagesHtml,
  exportFileName,
} from "../lib/export-pdf";
import { useAvatar } from "../lib/profile";
import { useModelOptions } from "../lib/model-profiles";
import type { ChatConflict } from "../lib/persistence";
import * as api from "../lib/api";

const UNGROUPED_KEY = "__ungrouped__";

const SIDEBAR_KEY = "deekai:sidebar:collapsed";

export interface ChatProps {
  /** 当前登录用户 id（用于读取本机头像与本机模型条目）；内存模式为 null */
  userId: string | null;
  store: "memory" | "supabase";
  /** 运营方预置的模型条目（只读）；用户自己的条目由本机存储按账号合并进来 */
  serverModelProfiles: PublicModelProfile[];
  onOpenSettings: () => void;
  /** 仅 memory 模式下可退出回到引导页 */
  onExitMemory?: () => void;
  /** 分享站点地址（拼分享链接用；桌面端需配置后链接才完整） */
  publicWebUrl: string | null;
}

/**
 * 会话主界面（自网页版 components/Chat.tsx 移植）：
 * 数据读写、上传、对话全部经由 lib/api 透明封装，UI 逻辑与网页版一致。
 */
export default function Chat({
  userId,
  store,
  serverModelProfiles,
  onOpenSettings,
  onExitMemory,
  publicWebUrl,
}: ChatProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    UploadedAttachment[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // 项目分组 UI 状态
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [conversationRenameValue, setConversationRenameValue] = useState("");
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [desktopHint, setDesktopHint] = useState(false);
  /** 待用户裁决的消息冲突（多端同时改同一会话） */
  const [conflicts, setConflicts] = useState<ChatConflict[]>([]);
  /** 已自动合并另一端消息的轻提示 */
  const [mergedHint, setMergedHint] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const userAvatar = useAvatar(userId);

  /**
   * 模型选项 = 本机条目（按账号存 localStorage）+ 运营方预置条目（只读）。
   * 选中项按账号记住；条目被删时自动回退。
   */
  const { options: modelOptions, selected: currentProfile, setSelectedId } =
    useModelOptions(userId, serverModelProfiles, store === "supabase");
  /** 当前条目是否支持图片附件（没有 Files API 的厂商只能发文档类附件） */
  const canUploadImages = currentProfile?.supportsFiles ?? false;

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  };

  const abortRef = useRef<{ abort(): void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const followRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersistRef = useRef(true);
  const draggingConvRef = useRef(false);
  const conversationsRef = useRef<Conversation[]>([]);
  /** 协议唤起指定的会话若尚未同步到本地，先记下，等数据刷新后再切 */
  const pendingActiveIdRef = useRef<string | null>(null);
  /** 多端同步拉取是否进行中（避免焦点/可见性事件重复发请求） */
  const reloadingRef = useRef(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const activeProject = active
    ? (projects.find((p) => p.id === active.projectId) ?? null)
    : null;

  const memoryMode = store === "memory";
  /** 当前需要用户处理的冲突（一次只提示一个） */
  const conflict = conflicts[0] ?? null;

  // 点击空白处关闭“移动分组”菜单
  useEffect(() => {
    const closeMenu = () => setMoveMenuFor(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  /** 把云端数据整体应用到界面；keepActive 为真时尽量保留当前会话 */
  const applyRemoteState = (data: ChatState, keepActive: boolean) => {
    // 数据刚来自云端，与云端一致，无需再回写一次
    skipPersistRef.current = true;
    setProjects(data.projects);
    setConversations(data.conversations);
    setActiveId((prev) =>
      keepActive && prev && data.conversations.some((c) => c.id === prev)
        ? prev
        : (data.conversations[0]?.id ?? null)
    );
  };

  /**
   * 多端同步：重新拉取云端会话数据（在网页端/另一台设备改动后，切回本窗口即可看到）。
   * 流式输出、上传中，或本地尚有未落库的改动时跳过，避免两端互相覆盖。
   */
  const reloadFromRemote = () => {
    if (memoryMode || !hydrated || reloadingRef.current) return;
    if (streaming || uploading || persistTimerRef.current) return;

    reloadingRef.current = true;
    api
      .loadChatState()
      .then((data) => {
        // 拉取期间本地又产生了改动 / 开始了流式回复 / 正在落库 → 丢弃这次结果
        if (persistTimerRef.current || abortRef.current || api.isSavingChatState()) {
          return;
        }
        applyRemoteState(data, true);
      })
      .catch(() => {
        // 拉取失败保留当前数据
      })
      .finally(() => {
        reloadingRef.current = false;
      });
  };

  // 窗口重新获得焦点 / 重新可见时同步云端数据。
  // 监听只注册一次，回调通过 ref 读取最新的判断条件（streaming / uploading 等）
  const reloadRef = useRef<() => void>(() => {});
  useEffect(() => {
    reloadRef.current = reloadFromRemote;
  });

  useEffect(() => {
    const sync = () => reloadRef.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // 订阅云端变更（Supabase Realtime）：另一端写完立刻刷新本端，
  // 不必等切窗口。聚焦刷新保留为兜底（例如订阅断开或事件被抑制时）。
  useEffect(() => {
    if (memoryMode || !hydrated) return;
    return api.subscribeChatChanges(() => reloadRef.current());
  }, [hydrated, memoryMode]);

  // 启动时加载数据：supabase 模式从云端拉取；memory 模式保持空状态
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (memoryMode) {
          if (!cancelled) setHydrated(true);
          return;
        }
        const data = await api.loadChatState();
        if (cancelled) return;
        applyRemoteState(data, false);
      } catch {
        // 加载失败按空状态处理
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 处理保存结果：
   * - 自动合并的会话：把本地消息换成云端+本端的合并结果（否则下次保存会把它覆盖回去）
   * - 无法自动合并的冲突：排队交给用户裁决
   */
  const handleSaveOutcome = (outcome: api.SaveOutcome) => {
    if (outcome.merged.length > 0) {
      const mergedMessages = new Map(
        outcome.merged.map((item) => [item.conversationId, item.messages])
      );
      setConversations((prev) =>
        prev.map((c) => {
          const messages = mergedMessages.get(c.id);
          return messages ? { ...c, messages } : c;
        })
      );
      setMergedHint(true);
      window.setTimeout(() => setMergedHint(false), 6000);
    }

    if (outcome.conflicts.length > 0) {
      setConflicts((prev) => {
        const queued = new Set(prev.map((c) => c.conversationId));
        return [
          ...prev,
          ...outcome.conflicts.filter((c) => !queued.has(c.conversationId)),
        ];
      });
    }
  };

  /** 冲突裁决：保留本端版本（强制覆盖云端）或采用另一端版本（重新拉取） */
  const resolveConflict = (choice: "mine" | "theirs") => {
    const conflict = conflicts[0];
    if (!conflict) return;
    setConflicts((prev) => prev.slice(1));

    if (choice === "theirs") {
      // 采用另一端：直接同步云端（会同时把本地状态与基线都对齐到云端）
      reloadFromRemote();
      return;
    }

    // 保留本端：用「当前最新」的消息强制写入，而不是冲突发生时的快照
    const current = conversationsRef.current.find(
      (c) => c.id === conflict.conversationId
    );
    api
      .forceSaveConversation(
        conflict.conversationId,
        current?.messages ?? conflict.mine
      )
      .catch((err: unknown) => window.alert((err as Error).message));
  };

  // 仅在 supabase 模式生效：状态稳定后 600ms 自动保存（memory 模式不落库）
  useEffect(() => {
    if (!hydrated || memoryMode) return;

    // 跳过初始化加载后的第一次触发，避免无意义地回写刚读到的数据
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      api
        .saveChatState({ projects, conversations })
        .then(handleSaveOutcome)
        .catch((err) => console.error("自动保存失败", err));
    }, 600);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, conversations, hydrated, memoryMode]);

  // 滚动跟随：仅当发送消息、切换会话或本来就贴着底部时自动滚到底；
  // AI 流式回复不会强制把视口拉到底部，避免打断正在阅读的内容
  const handleMessageListScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    followRef.current = distanceToBottom < 140;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followRef.current) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [active?.messages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // 桌面端：处理自定义协议唤起（deekai://open?conversation=..&draft=..）
  // 携带的会话若本地还没有（例如刚在网页端新建），先记下，等数据刷新后补切
  useEffect(() => {
    if (!hydrated) return;

    const apply = (link: DesktopDeeplink | null) => {
      if (!link) return;
      const target = link.conversationId;
      if (target) {
        if (conversationsRef.current.some((c) => c.id === target)) {
          pendingActiveIdRef.current = null;
          setActiveId(target);
          followRef.current = true;
        } else {
          pendingActiveIdRef.current = target;
        }
      }
      if (link.draft) {
        setInput(link.draft);
      }
    };

    const unsubscribe = api.onDeeplink(apply);
    // 启动时缓存的协议参数（消费一次）
    api
      .getPendingDeeplink()
      .then(apply)
      .catch(() => {});
    return unsubscribe;
  }, [hydrated]);

  // 协议指定的会话同步进来后再切过去
  useEffect(() => {
    const target = pendingActiveIdRef.current;
    if (!target || !conversations.some((c) => c.id === target)) return;
    pendingActiveIdRef.current = null;
    setActiveId(target);
    followRef.current = true;
  }, [conversations]);

  const conversationsOfProject = (projectId: string | null) =>
    conversations.filter((c) => c.projectId === projectId);

  const toggleProjectCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) =>
      prev.filter((attachment) => attachment.id !== id)
    );
  };

  const uploadFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;

    const list = Array.from(files);

    // 当前模型条目没有 Files API 时，图片附件直接拦在本地，避免白传一趟再报错
    if (!canUploadImages) {
      const blocked = list.filter((file) =>
        isSupportedImage({ type: file.type, name: file.name })
      );
      if (blocked.length > 0) {
        window.alert(
          `「${currentProfile?.name ?? "当前模型"}」不支持图片附件。\n请改用文档类附件（PDF / DOCX / TXT 等），或在设置 → 模型设置里切换到支持 Files API 的条目（如 DeepSeek）。`
        );
        if (blocked.length === list.length) return;
      }
    }

    setUploading(true);

    try {
      const uploaded = await Promise.all(
        list
          .filter(
            (file) =>
              canUploadImages ||
              !isSupportedImage({ type: file.type, name: file.name })
          )
          .map(async (file) => {
            try {
              return await api.uploadFile(file, currentProfile?.target ?? null);
            } catch (err) {
              throw new Error(
                `${file.name} 上传失败：${(err as Error).message}`
              );
            }
          })
      );

      setPendingAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      window.alert((error as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const beginCreateProject = () => {
    if (!hydrated || creatingProject) return;
    setCreatingProject(true);
    setNewProjectName("");
  };

  const commitCreateProject = () => {
    if (!hydrated || !creatingProject) return;
    const name = newProjectName.trim() || `项目 ${projects.length + 1}`;
    setProjects((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name },
    ]);
    setCreatingProject(false);
    setNewProjectName("");
  };

  const cancelCreateProject = () => {
    setCreatingProject(false);
    setNewProjectName("");
  };

  const beginRenameProject = (project: Project) => {
    setEditingProjectId(project.id);
    setRenameValue(project.name);
  };

  const commitRenameProject = () => {
    if (!hydrated || !editingProjectId) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === editingProjectId
          ? { ...p, name: renameValue.trim() || p.name }
          : p
      )
    );
    setEditingProjectId(null);
  };

  const cancelRenameProject = () => {
    setEditingProjectId(null);
  };

  const beginRenameConversation = (conversation: Conversation) => {
    if (!hydrated) return;
    setEditingConversationId(conversation.id);
    setConversationRenameValue(conversation.title);
    setMoveMenuFor(null);
  };

  const commitRenameConversation = () => {
    if (!hydrated || !editingConversationId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === editingConversationId
          ? { ...c, title: conversationRenameValue.trim() || c.title }
          : c
      )
    );
    setEditingConversationId(null);
  };

  const cancelRenameConversation = () => {
    setEditingConversationId(null);
  };

  const deleteProject = (id: string) => {
    if (!hydrated) return;
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    if (!window.confirm(`删除项目「${project.name}」？项目下的会话将移至“未分组”。`)) {
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setConversations((prev) =>
      prev.map((c) => (c.projectId === id ? { ...c, projectId: null } : c))
    );
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (editingProjectId === id) {
      setEditingProjectId(null);
    }
  };

  const newChat = (projectId: string | null = null) => {
    if (!hydrated) return;
    abortRef.current?.abort();
    setStreaming(false);
    setPendingAttachments([]);
    setMoveMenuFor(null);
    setEditingConversationId(null);
    followRef.current = true;
    const id = crypto.randomUUID();
    setConversations((prev) => [
      { id, title: "新对话", projectId, messages: [] },
      ...prev,
    ]);
    setActiveId(id);
  };

  const switchChat = (id: string) => {
    if (!hydrated || id === activeId) return;
    abortRef.current?.abort();
    setStreaming(false);
    setPendingAttachments([]);
    setMoveMenuFor(null);
    setEditingConversationId(null);
    followRef.current = true;
    setActiveId(id);
  };

  const deleteChat = (id: string) => {
    if (!hydrated) return;
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
        followRef.current = true;
      }
      return next;
    });
    if (moveMenuFor === id) {
      setMoveMenuFor(null);
    }
    if (editingConversationId === id) {
      setEditingConversationId(null);
    }
  };

  const moveConversation = (id: string, projectId: string | null) => {
    if (!hydrated) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, projectId } : c))
    );
    setMoveMenuFor(null);
    setDragOverKey(null);
  };

  // ---- 拖拽移动会话到分组 ----
  const handleGroupDragOver = (
    e: DragEvent<HTMLDivElement>,
    key: string,
    allow: boolean
  ) => {
    if (!allow) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
  };

  const handleGroupDragLeave = (
    e: DragEvent<HTMLDivElement>,
    key: string
  ) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOverKey((prev) => (prev === key ? null : prev));
    }
  };

  const handleGroupDrop = (e: DragEvent<HTMLDivElement>, key: string) => {
    e.preventDefault();
    draggingConvRef.current = false;
    const convId = e.dataTransfer.getData("text/plain");
    if (convId) {
      const targetProjectId = key === UNGROUPED_KEY ? null : key;
      moveConversation(convId, targetProjectId);
    } else {
      setDragOverKey(null);
    }
  };

  const setAssistantContent = (convId: string, content: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const messages = [...c.messages];
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant") {
          messages[messages.length - 1] = { ...last, content };
        } else {
          messages.push({ role: "assistant", content });
        }
        return { ...c, messages };
      })
    );
  };

  // 执行一次流式对话请求（调用方需先写入占位的 assistant 空消息）
  const streamCompletion = async (
    convId: string,
    history: ChatMessage[]
  ) => {
    if (!currentProfile) return;
    let acc = "";
    const handle = api.streamChat(history, currentProfile.target, (delta) => {
      acc += delta;
      setAssistantContent(convId, acc);
    });
    abortRef.current = handle;

    try {
      await handle.promise;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setAssistantContent(
        convId,
        acc || `出错了：${(err as Error).message}`
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!hydrated || !content || streaming) return;

    if (!currentProfile?.hasKey) {
      window.alert(
        `「${currentProfile?.name ?? "当前模型"}」尚未配置 API Key，请先在设置 → 模型设置中填写`
      );
      onOpenSettings();
      return;
    }

    const history: ChatMessage[] = active?.messages ?? [];
    let convId = activeId;

    if (!convId) {
      const newConvId = crypto.randomUUID();
      convId = newConvId;
      setConversations((prev) => [
        {
          id: newConvId,
          title: content.slice(0, 20),
          projectId: null,
          messages: [],
        },
        ...prev,
      ]);
      setActiveId(newConvId);
    }

    const userMsg: ChatMessage = {
      role: "user",
      content,
      attachments: pendingAttachments,
    };
    const nextHistory = [...history, userMsg];

    setInput("");
    setStreaming(true);
    setPendingAttachments([]);

    // 写入用户消息，并预留一个空的助手消息用于流式填充
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              title: c.title === "新对话" ? content.slice(0, 20) : c.title,
              messages: [...nextHistory, { role: "assistant", content: "" }],
            }
          : c
      )
    );

    followRef.current = true;
    await streamCompletion(convId, nextHistory);
  };

  const stopReply = () => {
    abortRef.current?.abort();
  };

  // 从某条消息处重新提问：保留到该消息为止的上下文，重新生成后续回答
  const regenerateFrom = (messageIndex: number, role: ChatMessage["role"]) => {
    if (!hydrated || streaming || !active) return;

    const messages = active.messages;
    if (messages.length === 0) return;

    const history =
      role === "user"
        ? messages.slice(0, messageIndex + 1)
        : messages.slice(0, messageIndex);

    if (history.length === 0) return;

    setStreaming(true);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? {
              ...c,
              messages: [...history, { role: "assistant", content: "" }],
            }
          : c
      )
    );
    streamCompletion(active.id, history);
  };

  const renderConversation = (c: Conversation) => (
    <div key={c.id} className="conversation-wrap">
      <div
        className={`conversation-item ${c.id === activeId ? "active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          switchChat(c.id);
        }}
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(e) => {
          draggingConvRef.current = true;
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          draggingConvRef.current = false;
          setDragOverKey(null);
        }}
      >
        <MessageSquare className="conversation-icon" size={15} />
        {editingConversationId === c.id ? (
          <input
            className="conversation-title-input"
            autoFocus
            value={conversationRenameValue}
            onChange={(e) => setConversationRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRenameConversation();
              } else if (e.key === "Escape") {
                cancelRenameConversation();
              }
            }}
            onBlur={commitRenameConversation}
          />
        ) : (
          <span className="conversation-title">{c.title}</span>
        )}
        <button
          className="icon-btn"
          title="重命名会话"
          onClick={(e) => {
            e.stopPropagation();
            beginRenameConversation(c);
          }}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-btn danger"
          title="删除对话"
          onClick={(e) => {
            e.stopPropagation();
            deleteChat(c.id);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {moveMenuFor === c.id ? (
        <div
          className="conv-move-menu"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="conv-move-title">移动到项目</div>
          <button
            className={`conv-move-option ${
              c.projectId === null ? "selected" : ""
            }`}
            onClick={() => moveConversation(c.id, null)}
          >
            未分组
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`conv-move-option ${
                c.projectId === p.id ? "selected" : ""
              }`}
              onClick={() => moveConversation(c.id, p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const headerTitle = active
    ? activeProject
      ? `${activeProject.name} / ${active.title}`
      : active.title
    : "DeekAI Chat";

  // 模型选择器：显示自定义条目名，括号里补上厂商实际模型名便于辨认
  const modelChoices = modelOptions.map((option) => ({
    id: option.id,
    label:
      option.model && option.model !== option.name
        ? `${option.name}（${option.model}）`
        : option.name,
  }));

  // 导出当前会话为 PDF：复用已渲染的消息 DOM + 打印专用样式
  const exportConversationPdf = async () => {
    const listEl = scrollRef.current;
    if (!active || !listEl || active.messages.length === 0) {
      window.alert("当前会话还没有可导出的内容");
      return;
    }

    const html = buildConversationHtml({
      title: activeProject ? `${activeProject.name} / ${active.title}` : active.title,
      subtitle: `导出时间：${new Date().toLocaleString()} · 共 ${active.messages.length} 条消息`,
      messagesHtml: buildMessagesHtml(listEl),
    });

    try {
      await api.exportPdf({ html, fileName: exportFileName(active.title) });
    } catch (err) {
      window.alert(`导出失败：${(err as Error).message}`);
    }
  };

  return (
    <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button className="new-chat" onClick={() => newChat(null)}>
          <Plus size={16} strokeWidth={2.2} />
          新建对话
        </button>
        <button className="new-project-btn" onClick={beginCreateProject}>
          <FolderPlus size={16} strokeWidth={2.2} />
          新建项目
        </button>

        {creatingProject ? (
          <div className="sidebar-input-row">
            <input
              className="sidebar-input"
              autoFocus
              placeholder="项目名称，回车确认"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCreateProject();
                } else if (e.key === "Escape") {
                  cancelCreateProject();
                }
              }}
              onBlur={commitCreateProject}
            />
          </div>
        ) : null}

        <nav className="conversation-list">
          {projects.map((p) => {
            const groupConversations = conversationsOfProject(p.id);
            const isCollapsed = collapsed.has(p.id);

            return (
              <div
                key={p.id}
                className={`project-group ${
                  dragOverKey === p.id ? "drag-over" : ""
                }`}
                onDragOver={(e) =>
                  handleGroupDragOver(e, p.id, hydrated && draggingConvRef.current)
                }
                onDragLeave={(e) => handleGroupDragLeave(e, p.id)}
                onDrop={(e) => handleGroupDrop(e, p.id)}
              >
                <div
                  className="project-header"
                  onClick={() => toggleProjectCollapsed(p.id)}
                >
                  <span className="project-chevron">
                    {isCollapsed ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </span>
                  {editingProjectId === p.id ? (
                    <input
                      className="sidebar-input project-name-input"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRenameProject();
                        } else if (e.key === "Escape") {
                          cancelRenameProject();
                        }
                      }}
                      onBlur={commitRenameProject}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="project-name">{p.name}</span>
                  )}
                  <span className="project-count">
                    {groupConversations.length}
                  </span>
                  <span
                    className="project-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="icon-btn"
                      title="在本项目新建对话"
                      onClick={() => newChat(p.id)}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="重命名项目"
                      onClick={() => beginRenameProject(p)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="删除项目"
                      onClick={() => deleteProject(p.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>

                {!isCollapsed && groupConversations.length > 0 ? (
                  <div className="project-children">
                    {groupConversations.map(renderConversation)}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div
            className={`project-group ${
              dragOverKey === UNGROUPED_KEY ? "drag-over" : ""
            }`}
            onDragOver={(e) =>
              handleGroupDragOver(
                e,
                UNGROUPED_KEY,
                hydrated && draggingConvRef.current
              )
            }
            onDragLeave={(e) => handleGroupDragLeave(e, UNGROUPED_KEY)}
            onDrop={(e) => handleGroupDrop(e, UNGROUPED_KEY)}
          >
            <div
              className="project-header"
              onClick={() => toggleProjectCollapsed(UNGROUPED_KEY)}
            >
              <span className="project-chevron">
                {collapsed.has(UNGROUPED_KEY) ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </span>
              <span className="project-name">未分组</span>
              <span className="project-count">
                {conversationsOfProject(null).length}
              </span>
              <span
                className="project-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="icon-btn"
                  title="新建未分组对话"
                  onClick={() => newChat(null)}
                >
                  <Plus size={14} />
                </button>
              </span>
            </div>

            {!collapsed.has(UNGROUPED_KEY) ? (
              <div className="project-children">
                {conversationsOfProject(null).map(renderConversation)}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="sidebar-user">
          <button
            className="sidebar-settings-btn"
            onClick={onOpenSettings}
            title="设置（账号 / 外观 / 数据存储 / 模型 / 分享）"
          >
            <Settings size={15} />
            设置
          </button>
        </div>
        <div className="sidebar-footer">
          Powered by DeepSeek
          {hydrated
            ? memoryMode
              ? " · 内存模式"
              : " · 已持久化"
            : ""}
        </div>
      </aside>

      <main className="main">
        {memoryMode ? (
          <div className="memory-banner">
            <Database size={14} />
            <span>当前为内存模式：数据仅在本次运行中保留，关闭窗口即清空。</span>
            <button onClick={onOpenSettings}>打开设置接入云存储</button>
            {onExitMemory ? (
              <button className="link" onClick={onExitMemory}>
                返回引导
              </button>
            ) : null}
          </div>
        ) : null}

        <header className="chat-header">
          <div className="chat-header-left">
            <button
              className="icon-btn header-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "展开会话列表" : "收起会话列表"}
            >
              <Menu size={17} />
            </button>
            <h1 title={headerTitle}>{headerTitle}</h1>
          </div>
          <div className="chat-header-actions">
            <select
              className="model-select"
              value={currentProfile?.id ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              title={
                currentProfile?.hasKey
                  ? "选择模型"
                  : "当前条目未配置 API Key，点击右侧设置填写"
              }
              disabled={uploading || streaming}
            >
              {modelChoices.length === 0 ? (
                <option value="">未配置模型</option>
              ) : null}
              {modelChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              className="icon-btn header-settings"
              title={memoryMode ? "分享需要云存储（Supabase）模式" : "分享当前会话"}
              onClick={() => {
                if (memoryMode) {
                  window.alert("分享需要云存储（Supabase）模式，请在设置中配置后使用");
                  return;
                }
                if (!active) {
                  window.alert("请先选择一个会话");
                  return;
                }
                setShareOpen(true);
              }}
            >
              <Share2 size={17} />
            </button>
            <button
              className="icon-btn header-settings"
              title="导出当前会话为 PDF"
              onClick={exportConversationPdf}
            >
              <FileDown size={17} />
            </button>
            {api.bridgeKind === "web" ? (
              <button
                className="header-desktop-btn"
                onClick={() => {
                  api.openDesktop({
                    conversationId: activeId,
                    draft: input,
                  });
                  setDesktopHint(true);
                  window.setTimeout(() => setDesktopHint(false), 6000);
                }}
                title="在已安装的桌面端打开，并携带当前会话与输入草稿"
              >
                <Monitor size={15} />
                桌面端
              </button>
            ) : null}
          </div>
        </header>

        {desktopHint ? (
          <div className="main-hint">
            <Monitor size={14} />
            已尝试唤起桌面端；若未安装，请先运行 DeekAI 安装包（浏览器首次会询问是否允许打开）。
          </div>
        ) : null}

        {conflict ? (
          <div className="main-hint conflict-hint">
            <AlertTriangle size={14} />
            <span className="conflict-text">
              「{conflict.title}」在另一台设备上也有改动，无法自动合并：
              这边 {conflict.mine.length} 条消息，另一台设备 {conflict.theirs.length} 条消息。要保留哪一份？
            </span>
            <button
              className="hint-action"
              onClick={() => resolveConflict("mine")}
            >
              保留我这边的
            </button>
            <button
              className="hint-action"
              onClick={() => resolveConflict("theirs")}
            >
              用另一台设备的
            </button>
          </div>
        ) : null}

        {conflicts.length > 1 ? (
          <div className="main-hint">
            <AlertTriangle size={14} />
            还有 {conflicts.length - 1} 个会话存在同类冲突，处理完当前这个会继续提示。
          </div>
        ) : null}

        {mergedHint ? (
          <div className="main-hint">
            <Sparkles size={14} />
            已把另一台设备上的新消息合并进当前会话。
          </div>
        ) : null}

        <div className="message-list" ref={scrollRef} onScroll={handleMessageListScroll}>
          {!active || active.messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Sparkles size={30} />
              </div>
              <div className="empty-logo">DeekAI</div>
              <p>有什么可以帮你？</p>
            </div>
          ) : (
            active.messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <div className="avatar">
                  {m.role === "user" ? (
                    userAvatar ? (
                      <img className="avatar-image" src={userAvatar} alt="用户头像" />
                    ) : (
                      <User size={15} />
                    )
                  ) : (
                    <Bot size={15} />
                  )}
                </div>
                <div className="msg-main">
                  <div className="bubble">
                    {m.attachments && m.attachments.length > 0 ? (
                      <div className="attachment-list">
                        {m.attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="attachment-chip static"
                          >
                            <span className="attachment-kind">
                              {attachment.kind === "image" ? "图片" : "文档"}
                            </span>
                            <span className="attachment-name">
                              {attachment.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {m.content ? (
                      m.role === "assistant" ? (
                        <Markdown content={m.content} />
                      ) : (
                        m.content
                      )
                    ) : null}
                  </div>
                  <div className="msg-actions">
                    <button
                      type="button"
                      className="msg-action"
                      title="以这条消息为起点重新提问"
                      disabled={streaming || uploading}
                      onClick={() => regenerateFrom(i, m.role)}
                    >
                      <RotateCcw size={13} />
                      重新提问
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {streaming ? (
          <div className="reply-bar">
            <span className="spinner" />
            AI 正在回复中…
            <button type="button" className="reply-stop" onClick={stopReply}>
              停止
            </button>
          </div>
        ) : null}

        <div className="input-area">
          <div className="composer">
            {pendingAttachments.length > 0 ? (
              <div className="attachment-list">
                {pendingAttachments.map((attachment) => (
                  <div key={attachment.id} className="attachment-chip">
                    <span className="attachment-kind">
                      {attachment.kind === "image" ? "图片" : "文档"}
                    </span>
                    <span className="attachment-name">
                      {attachment.name}
                    </span>
                    {attachment.kind === "image" &&
                    currentProfile?.visionModel &&
                    currentProfile.model !== currentProfile.visionModel ? (
                      <span className="attachment-hint">将自动切换视觉模型</span>
                    ) : null}
                    <button
                      type="button"
                      className="attachment-remove"
                      onClick={() => removePendingAttachment(attachment.id)}
                      disabled={streaming || uploading}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="composer-box">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                onPaste={(e) => {
                  if (streaming || uploading) return;
                  const items = Array.from(e.clipboardData?.items ?? []);
                  const pastedFiles = items
                    .filter((item) => item.kind === "file")
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => Boolean(file));

                  if (pastedFiles.length === 0) return;
                  // 粘贴图片/文件时上传为附件，不写入文本
                  e.preventDefault();
                  uploadFiles(pastedFiles);
                }}
                placeholder={
                  currentProfile?.hasKey
                    ? canUploadImages
                      ? "输入消息… 可直接粘贴图片/文件上传，Enter 发送"
                      : "输入消息… 可粘贴文档类附件（PDF/DOCX/TXT），Enter 发送"
                    : "当前模型条目尚未配置 API Key，请点击右上角设置 →「模型设置」填写"
                }
                rows={1}
              />

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden-file-input"
                onChange={(e) => uploadFiles(e.target.files)}
                accept={
                  canUploadImages
                    ? ".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.c,.cpp,.h,.hpp,.sql,.log,.ini,.env,.pdf,.docx,image/jpeg,image/png,image/gif,image/webp"
                    : ".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.c,.cpp,.h,.hpp,.sql,.log,.ini,.env,.pdf,.docx"
                }
              />

              <button
                type="button"
                className="round-btn attach-round"
                title={
                  canUploadImages
                    ? "上传文件（或直接粘贴图片/文件到输入框）"
                    : "上传文档类附件（当前模型条目不支持图片）"
                }
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming || uploading}
              >
                {uploading ? (
                  <span className="spinner" />
                ) : (
                  <Paperclip size={18} />
                )}
              </button>

              <button
                type="button"
                className="round-btn send-round"
                onClick={send}
                aria-label="发送"
                disabled={
                  !hydrated ||
                  streaming ||
                  uploading ||
                  (!input.trim() && pendingAttachments.length === 0)
                }
              >
                {streaming ? (
                  <span className="spinner" />
                ) : (
                  <ArrowUp size={18} strokeWidth={2.4} />
                )}
              </button>
            </div>
          </div>
        </div>
      </main>

      <ShareDialog
        open={shareOpen}
        conversation={active}
        projectName={activeProject?.name ?? null}
        publicWebUrl={publicWebUrl}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
