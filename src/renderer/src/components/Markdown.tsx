import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { clipboardWrite, openExternal } from "../lib/api";

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = preRef.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时退回主进程剪贴板
      try {
        await clipboardWrite(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // 都失败则忽略
      }
    }
  };

  return (
    <div className="code-block">
      <button className="copy-btn" onClick={copy}>
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          return <CodeBlock>{children}</CodeBlock>;
        },
        // 外部链接一律走系统浏览器，避免应用内导航丢失会话状态
        a({ href, children }) {
          return (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) openExternal(href);
              }}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
