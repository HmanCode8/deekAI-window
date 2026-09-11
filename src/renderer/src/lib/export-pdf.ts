/**
 * 会话导出 HTML 生成：
 * 直接复用已渲染的消息 DOM（Markdown / 代码高亮 / 表格都保持原样），
 * 移除交互元素后套一份打印专用样式（浅色、A4 友好），
 * 桌面端交给主进程 printToPDF 落盘，网页端用于 window.print()。
 */

const PRINT_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 28px 34px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #1f2328;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.export-head { border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 20px; }
.export-title { font-size: 20px; font-weight: 700; }
.export-meta { font-size: 12px; color: #6b7280; margin-top: 6px; }
.message { display: flex; gap: 10px; margin: 0 0 16px; page-break-inside: avoid; }
.message.user { flex-direction: row-reverse; }
.avatar {
  width: 26px; height: 26px; min-width: 26px; border-radius: 8px;
  color: #fff; display: flex; align-items: center; justify-content: center;
}
.avatar svg { width: 13px; height: 13px; }
/* 用户上传的头像：约束为与图标一致的小尺寸，避免打印时按原图撑开 */
.avatar img {
  width: 100%; height: 100%; display: block;
  object-fit: cover; border-radius: 8px;
}
.message.user .avatar { background: #10a37f; }
.message.assistant .avatar { background: #202123; }
.msg-main { display: flex; flex-direction: column; max-width: 88%; }
.message.user .msg-main { align-items: flex-end; }
.bubble {
  padding: 10px 14px; border-radius: 12px; font-size: 13.5px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.message.assistant .bubble { background: #f7f7f8; }
.message.user .bubble { background: #10a37f; color: #fff; }
.bubble > :first-child { margin-top: 0; }
.bubble > :last-child { margin-bottom: 0; }
.bubble p { margin: 0 0 6px; }
.bubble ul, .bubble ol { margin: 4px 0 8px; padding-left: 20px; }
.bubble li { margin: 3px 0; line-height: 1.55; }
.bubble h1, .bubble h2, .bubble h3, .bubble h4 { margin: 12px 0 6px; font-size: 1.05em; font-weight: 600; }
.bubble a { color: #0d7f63; text-decoration: none; }
.bubble hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
.bubble blockquote { margin: 8px 0; padding: 4px 14px; border-left: 3px solid #d9d9e3; color: #6b7280; }
.bubble table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12.5px; }
.bubble th, .bubble td { border: 1px solid #d9d9e3; padding: 5px 9px; }
/* Markdown 中的图片同样限制宽度，避免超出纸张 */
.bubble img { max-width: 100%; height: auto; }
.bubble code {
  background: #ececf1; padding: 1px 4px; border-radius: 4px; font-size: 12px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
.message.user .bubble code { background: rgba(255, 255, 255, 0.22); color: #fff; }
.code-block { position: relative; margin: 8px 0; }
.code-block pre {
  margin: 0; padding: 12px 14px; border-radius: 8px; background: #0d1117;
  color: #e6edf3; font-size: 12px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
.code-block pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; }
.attachment-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.attachment-chip {
  font-size: 11px; border: 1px solid #d9d9e3; border-radius: 6px;
  padding: 2px 7px; color: #6b7280;
}
.message.user .attachment-chip { border-color: rgba(255, 255, 255, 0.45); color: #fff; }
.export-footer { margin-top: 24px; text-align: center; font-size: 11px; color: #9ca3af; }
@media print { .message { page-break-inside: avoid; } }
`;

const INTERACTIVE_SELECTORS = [".msg-actions", ".copy-btn", ".attachment-remove"];

/** 克隆消息列表 DOM，去掉交互元素后返回 HTML 片段 */
export function buildMessagesHtml(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const selector of INTERACTIVE_SELECTORS) {
    clone.querySelectorAll(selector).forEach((node) => node.remove());
  }
  return clone.innerHTML;
}

export function buildConversationHtml(options: {
  title: string;
  subtitle: string;
  messagesHtml: string;
}): string {
  const { title, subtitle, messagesHtml } = options;
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<header class="export-head">
  <div class="export-title">${safeTitle}</div>
  <div class="export-meta">${escapeHtml(subtitle)}</div>
</header>
<main>${messagesHtml}</main>
<footer class="export-footer">由 DeekAI 导出 · Powered by DeepSeek</footer>
</body>
</html>`;
}

export function exportFileName(title: string): string {
  const clean =
    title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "conversation";
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${clean}-${stamp}.pdf`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
