import {
  MODELS,
  type ChatMessage,
  type UploadedAttachment,
} from "@shared/attachments";
import type { ChatStreamEvent } from "@shared/bridge-api";
import {
  DEFAULT_MODEL_BASE_URL,
  type ResolvedModel,
} from "@shared/model-profiles";

/**
 * 模型流式对话（主进程/服务端）：组装视觉/文档上下文 -> 请求上游 -> SSE 解析 -> 事件推送。
 * 走标准 OpenAI 兼容协议（{baseUrl}/chat/completions），与具体厂商无关；
 * 条目信息由配置层解析成 ResolvedModel 传入，这里不关心它来自哪个厂商。
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
  /** 解析好的模型条目（含密钥、Base URL、模型名与文件能力） */
  profile: ResolvedModel;
  signal?: AbortSignal;
}

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
  supportsVision: boolean
): DeepSeekMessage[] {
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
  const { id, signal, profile } = params;
  const apiKey = profile.apiKey;
  const chatMessages = params.messages as ChatMessage[];
  // 仅当条目声明了视觉模型（目前是 DeepSeek）且消息里含图片时才切换，避免把别的厂商的模型名覆盖掉
  const model =
    hasImageAttachments(chatMessages) && profile.visionModel
      ? profile.visionModel
      : profile.model || MODELS[0].id;

  // 只有条目具备 Files API（能引用 file_id）时才把图片作为内容块发上去
  const upstreamMessages = toDeepSeekMessages(
    chatMessages,
    profile.supportsFiles
  );

  let response: Response;
  try {
    response = await fetch(resolveChatCompletionsUrl(profile.baseUrl), {
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
