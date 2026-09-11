import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import {
  isDocx,
  isPdf,
  isSupportedImage,
  isSupportedTextDocument,
  type UploadedAttachment,
} from "@shared/attachments";
import type { UploadInput } from "@shared/bridge-api";
import { DEFAULT_MODEL_BASE_URL, type ResolvedModel } from "@shared/model-profiles";

/**
 * 文件处理（主进程/服务端）：
 * - 图片 -> 模型服务的 Files API（{baseUrl}/files），只有声明了 supportsFiles 的条目可用
 * - 文档 -> 本地解析为文本（PDF / DOCX / 文本代码），与厂商无关，任何条目都能用
 */

const MAX_FILE_SIZE = 64 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 12000;

function normalizeWhitespace(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateText(text: string) {
  const normalized = normalizeWhitespace(text);

  if (normalized.length <= MAX_EXTRACTED_CHARS) {
    return { text: normalized, truncated: false };
  }

  return {
    text: normalized.slice(0, MAX_EXTRACTED_CHARS),
    truncated: true,
  };
}

async function extractDocumentText(buffer: Buffer, meta: { type: string; name: string }) {
  if (isPdf(meta)) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return truncateText(result.text || "");
    } finally {
      await parser.destroy();
    }
  }

  if (isDocx(meta)) {
    const result = await mammoth.extractRawText({ buffer });
    return truncateText(result.value || "");
  }

  if (isSupportedTextDocument(meta)) {
    return truncateText(buffer.toString("utf-8"));
  }

  throw new Error(
    "暂不支持该文档格式。当前支持 TXT/MD/CSV/JSON/代码文件/PDF/DOCX。"
  );
}

async function uploadImageToDeepSeek(
  name: string,
  type: string,
  buffer: Buffer,
  apiKey: string,
  baseUrl?: string | null
) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: type || "application/octet-stream" });
  formData.append("purpose", "user_data");
  formData.append("file", blob, name);

  const base = (baseUrl?.trim() || DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");

  const response = await fetch(`${base}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `上传到 DeepSeek Files API 失败 (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    throw new Error("DeepSeek Files API 未返回 file_id");
  }

  return data.id;
}

export async function handleUpload(
  input: UploadInput,
  profile: ResolvedModel
): Promise<UploadedAttachment> {
  const { apiKey, baseUrl } = profile;

  if (!apiKey) {
    throw new Error(`「${profile.name}」未配置 API Key，请在设置中填写`);
  }

  if (!input?.name) {
    throw new Error("缺少上传文件");
  }
  if (input.size === 0) {
    throw new Error("文件不能为空");
  }
  if (input.size > MAX_FILE_SIZE) {
    throw new Error("文件过大，单文件最大支持 64MB");
  }

  const buffer = Buffer.from(input.bytes);
  const mimeType = input.type || "application/octet-stream";
  const meta = { type: mimeType, name: input.name };

  if (isSupportedImage(meta)) {
    if (!profile.supportsFiles) {
      throw new Error(
        `「${profile.name}」不支持图片附件（缺少 Files API）。请改用文档类附件（PDF/DOCX/TXT 等），或切换到提供 Files API 的模型条目（如 DeepSeek）。`
      );
    }

    const fileId = await uploadImageToDeepSeek(
      input.name,
      mimeType,
      buffer,
      apiKey,
      baseUrl
    );
    return {
      id: crypto.randomUUID(),
      name: input.name,
      mimeType,
      size: input.size,
      kind: "image",
      fileId,
    };
  }

  const { text, truncated } = await extractDocumentText(buffer, meta);

  if (!text) {
    throw new Error(
      "文件上传成功，但未提取到可用文本。可能是扫描件、图片型 PDF，或内容为空。"
    );
  }

  return {
    id: crypto.randomUUID(),
    name: input.name,
    mimeType,
    size: input.size,
    kind: "document",
    extractedText: text,
    truncated,
  };
}
