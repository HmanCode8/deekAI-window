import { useEffect, useState } from "react";
import { Bot, User } from "lucide-react";
import Markdown from "./Markdown";
import { loadSharedConversation, type SharedConversation } from "../lib/share";

/**
 * 只读分享页（路由 #/share/<token>）：
 * 桌面端与网页端共用；数据通过 Supabase 匿名只读获取，无需登录。
 */
export default function SharedView({
  token,
  ready,
}: {
  token: string;
  ready: boolean;
}) {
  const [data, setData] = useState<SharedConversation | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading"
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setState("loading");

    loadSharedConversation(token)
      .then((conversation) => {
        if (cancelled) return;
        if (conversation) {
          setData(conversation);
          setState("ready");
        } else {
          setState("missing");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "读取分享失败");
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [token, ready]);

  if (state === "loading") {
    return (
      <div className="boot-screen">
        <span className="spinner boot-spinner" />
        <div>正在加载分享内容…</div>
      </div>
    );
  }

  if (state === "missing" || state === "error" || !data) {
    return (
      <div className="share-page">
        <div className="share-empty">
          <h2>无法打开该分享</h2>
          <p>{state === "missing" ? "链接无效或分享已被撤销。" : error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="share-page">
      <header className="share-header">
        <div style={{ minWidth: 0 }}>
          <div className="share-title">{data.title}</div>
          <div className="share-meta">
            {data.projectName ? `${data.projectName} · ` : ""}
            {data.createdAt
              ? `分享于 ${new Date(data.createdAt).toLocaleString()}`
              : "共享会话"}
            {` · 共 ${data.messages.length} 条消息 · 只读`}
          </div>
        </div>
      </header>

      <main className="share-body">
        {data.messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="avatar">
              {message.role === "user" ? <User size={15} /> : <Bot size={15} />}
            </div>
            <div className="msg-main">
              <div className="bubble">
                {message.attachments && message.attachments.length > 0 ? (
                  <div className="attachment-list">
                    {message.attachments.map((attachment) => (
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
                {message.content
                  ? message.role === "assistant"
                    ? <Markdown content={message.content} />
                    : message.content
                  : null}
              </div>
            </div>
          </div>
        ))}
      </main>

      <footer className="share-footer">由 DeekAI 分享 · Powered by DeepSeek</footer>
    </div>
  );
}
