import {
  VISION_MODEL_ID,
  type ChatMessage,
  type UploadedAttachment,
} from "@shared/attachments";
import type { ChatStreamEvent } from "@shared/bridge-api";

/**
 * DeepSeek 流式对话（主进程）：组装视觉/文档上下文 -> 请求上游 -> SSE 解析 -> 事件推送。
 * 逻辑与网页版 app/api/chat/route.ts 保持一致，密钥仅存在于主进程。
 */

type DeepSeekContentPart =
  | { type: "text"; text: string }
  | { type: "file"; file_id: string };

type DeepSeekMessage =
  | {
      role: "user";
      content: string | DeepSeekContentPart[];
    }
  | {
      role: "assistant";
      content: string;
    };

export interface StreamChatParams {
  id: string;
  messages: ChatMessage[];
  model?: string;
  apiKey: string;
  /** 模型服务 Base URL（OpenAI 兼容），默认 DeepSeek 官方 */
  baseUrl?: string | null;
  fallbackModel?: string | null;
  signal?: AbortSignal;
}

export const DEFAULT_MODEL_BASE_URL = "https://api.deepseek.com";

export function resolveChatCompletionsUrl(baseUrl?: string | null): string {
  const base = (baseUrl?.trim() || DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function buildDocumentContext(attachments: UploadedAttachment[] = []) {
  const documents = attachments.filter(
    (attachment) => attachment.kind === "document" && attachment.extractedText
  );

  if (documents.length === 0) {
    return "";
  }

  return documents
    .map((attachment, index) => {
      const truncateNote = attachment.truncated ? "\n[内容已截断]" : "";
      return `[文件 ${index + 1}] ${attachment.name}\n${attachment.extractedText}${truncateNote}`;
    })
    .join("\n\n");
}

function hasImageAttachments(messages: ChatMessage[]) {
  return messages.some((message) =>
    message.attachments?.some((attachment) => attachment.kind === "image")
  );
}

function toDeepSeekMessages(
  messages: ChatMessage[],
  model: string
): DeepSeekMessage[] {
  const supportsVision = model === VISION_MODEL_ID;

  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
      };
    }

    const attachments = message.attachments ?? [];
    const documentContext = buildDocumentContext(attachments);
    const imageAttachments = attachments.filter(
      (attachment) => attachment.kind === "image" && attachment.fileId
    );

    const textParts = [message.content.trim()].filter(Boolean);

    if (documentContext) {
      textParts.push(
        `以下是用户上传文件的解析内容，请结合这些内容回答：\n\n${documentContext}`
      );
    }

    if (!supportsVision && imageAttachments.length > 0) {
      textParts.push(
        `用户还上传了图片文件：${imageAttachments
          .map((attachment) => attachment.name)
          .join("、")}。`
      );
    }

    const baseText = textParts.join("\n\n").trim() || "请结合上传的附件回答。";

    if (!supportsVision || imageAttachments.length === 0) {
      return {
        role: "user",
        content: baseText,
      };
    }

    return {
      role: "user",
      content: [
        { type: "text", text: baseText },
        ...imageAttachments.map((attachment) => ({
          type: "file" as const,
          file_id: attachment.fileId!,
        })),
      ],
    };
  });
}

/**
 * 执行一次流式对话，按 id 推送 delta/done/stopped/error 事件。
 * 正常完成或遇到错误都会自行结束（不再抛错）。
 */
export async function streamChat(
  params: StreamChatParams,
  emit: (event: ChatStreamEvent) => void
): Promise<void> {
  const { id, apiKey, signal } = params;
  const chatMessages = params.messages as ChatMessage[];
  const model = hasImageAttachments(chatMessages)
    ? VISION_MODEL_ID
    : params.model || params.fallbackModel || "deepseek-v4-flash";

  const upstreamMessages = toDeepSeekMessages(chatMessages, model);

  let response: Response;
  try {
    response = await fetch(resolveChatCompletionsUrl(params.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: upstreamMessages,
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      emit({ id, type: "stopped" });
      return;
    }
    emit({ id, type: "error", message: `请求 DeepSeek 出错: ${(err as Error).message}` });
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    emit({
      id,
      type: "error",
      message: `DeepSeek 请求失败 (${response.status}): ${text}`,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            emit({ id, type: "delta", text: delta });
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }
    emit({ id, type: "done" });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      emit({ id, type: "stopped" });
    } else {
      emit({ id, type: "error", message: (err as Error).message });
    }
  }
}
