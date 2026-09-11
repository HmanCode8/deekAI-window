import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Trash2, X } from "lucide-react";
import type { Conversation } from "@shared/chat-types";
import * as api from "../lib/api";
import {
  buildShareUrl,
  createShare,
  getShareToken,
  revokeShare,
} from "../lib/share";

interface ShareDialogProps {
  open: boolean;
  conversation: Conversation | null;
  projectName: string | null;
  publicWebUrl: string | null;
  onClose: () => void;
}

/**
 * 分享弹窗：生成 / 复制 / 撤销只读分享链接。
 * 分享是基于 Supabase 的会话快照；链接由随机 token 组成。
 */
export default function ShareDialog({
  open,
  conversation,
  projectName,
  publicWebUrl,
  onClose,
}: ShareDialogProps) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !conversation) return;
    const existing = getShareToken(conversation.id);
    setLink(existing ? buildShareUrl(existing, publicWebUrl) : "");
    setError("");
    setCopied(false);
    setBusy(false);
  }, [open, conversation, publicWebUrl]);

  if (!open || !conversation) return null;

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await createShare(conversation, projectName, publicWebUrl);
      setLink(result.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await api.clipboardWrite(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const revoke = async () => {
    const token = getShareToken(conversation.id);
    if (!token) return;
    if (!window.confirm("确定撤销该分享链接吗？撤销后原链接立即失效。")) return;

    setBusy(true);
    setError("");
    try {
      await revokeShare(conversation.id, token);
      setLink("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div className="settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>分享会话</h2>
          <button className="settings-close" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-hint">
            分享内容为当前会话的快照（只读），对方打开链接即可查看；链接由随机
            token 生成，撤销后立即失效。
          </div>

          {link ? (
            <>
              <div className="share-link-row">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="share-btn" onClick={copy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>

              <div className="share-actions">
                {/^https?:/i.test(link) ? (
                  <button
                    className="share-btn"
                    onClick={() => api.openExternal(link)}
                  >
                    <ExternalLink size={14} />
                    在浏览器打开
                  </button>
                ) : null}
                <button
                  className="share-btn danger"
                  onClick={revoke}
                  disabled={busy}
                >
                  <Trash2 size={14} />
                  撤销分享
                </button>
              </div>
            </>
          ) : (
            <button
              className="share-btn primary"
              onClick={generate}
              disabled={busy}
            >
              <Link2 size={14} />
              {busy ? "生成中…" : "生成分享链接"}
            </button>
          )}

          {!publicWebUrl ? (
            <div className="share-note">
              提示：未配置「分享站点地址（PUBLIC_WEB_URL）」，链接可能不完整。
              建议在设置中填写网页端的部署地址（如 https://your-site.com）。
            </div>
          ) : null}

          {error ? <div className="auth-error">{error}</div> : null}

          <div className="share-note">
            首次使用需在 Supabase 执行迁移：
            supabase/migrations/create_shared_conversations.sql
          </div>
        </div>
      </div>
    </div>
  );
}
