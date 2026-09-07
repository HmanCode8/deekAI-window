import { useEffect, useRef, useState, type DragEvent } from "react";
import Markdown from "./Markdown";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Database,
  FolderPlus,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import type { ChatMessage, UploadedAttachment } from "@shared/attachments";
import { MODELS, VISION_MODEL_ID } from "@shared/attachments";
import type { Conversation, Project } from "@shared/chat-types";
import * as api from "../lib/api";

const UNGROUPED_KEY = "__ungrouped__";

export interface ChatProps {
  /** supabase 模式下为登录用户；memory 模式下为 null */
  user: { id: string; email: string } | null;
  store: "memory" | "supabase";
  deepseekConfigured: boolean;
  onLogout: () => void;
  onOpenSettings: () => void;
  /** 仅 memory 模式下可退出回到引导页 */
  onExitMemory?: () => void;
}

/**
 * 会话主界面（自网页版 components/Chat.tsx 移植）：
 * 数据读写、上传、对话全部经由 lib/api 透明封装，UI 逻辑与网页版一致。
 */
export default function Chat({
  user,
  store,
  deepseekConfigured,
  onLogout,
  onOpenSettings,
  onExitMemory,
}: ChatProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState<string>(MODELS[0].id);
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

  const abortRef = useRef<{ abort(): void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const followRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersistRef = useRef(true);
  const draggingConvRef = useRef(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const activeProject = active
    ? (projects.find((p) => p.id === active.projectId) ?? null)
    : null;

  const memoryMode = store === "memory";

  // 点击空白处关闭“移动分组”菜单
  useEffect(() => {
    const closeMenu = () => setMoveMenuFor(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

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
        setProjects(data.projects);
        setConversations(data.conversations);
        setActiveId(data.conversations[0]?.id ?? null);
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
      api.saveChatState({ projects, conversations }).catch((err) =>
        console.error("自动保存失败", err)
      );
    }, 600);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
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

    setUploading(true);

    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async (file) => {
          try {
            return await api.uploadFile(file);
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
    let acc = "";
    const handle = api.streamChat(history, model, (delta) => {
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

    if (!deepseekConfigured) {
      window.alert("尚未配置 DeepSeek API Key，请先在设置中填写");
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

  return (
    <div className="app">
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
          <span className="sidebar-user-email" title={user?.email ?? "内存模式"}>
            {user?.email ?? "本地 · 内存模式"}
          </span>
          <div className="sidebar-user-actions">
            <button
              className="sidebar-text-btn"
              onClick={onOpenSettings}
              title="应用设置"
            >
              <Settings size={14} />
              设置
            </button>
            {user ? (
              <button className="sidebar-logout" onClick={onLogout} title="退出登录">
                退出
              </button>
            ) : null}
          </div>
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
          <h1 title={headerTitle}>{headerTitle}</h1>
          <div className="chat-header-actions">
            <select
              className="model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              title="选择模型"
              disabled={uploading || streaming}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              className="icon-btn header-settings"
              title="应用设置"
              onClick={onOpenSettings}
            >
              <Settings size={17} />
            </button>
          </div>
        </header>

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
                    <User size={15} />
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
                    model !== VISION_MODEL_ID ? (
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
                  deepseekConfigured
                    ? "输入消息… 可直接粘贴图片/文件上传，Enter 发送"
                    : "尚未配置 DeepSeek API Key，请点击右上角设置填写后开始对话"
                }
                rows={1}
              />

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden-file-input"
                onChange={(e) => uploadFiles(e.target.files)}
                accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.c,.cpp,.h,.hpp,.sql,.log,.ini,.env,.pdf,.docx,image/jpeg,image/png,image/gif,image/webp"
              />

              <button
                type="button"
                className="round-btn attach-round"
                title="上传文件（或直接粘贴图片/文件到输入框）"
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
    </div>
  );
}
