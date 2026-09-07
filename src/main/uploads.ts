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

/**
 * 文件处理（主进程）：图片 -> DeepSeek Files API；文档 -> 本地解析为文本。
 * 逻辑与网页版 app/api/upload/route.ts 保持一致。
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
  apiKey: string
) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: type || "application/octet-stream" });
  formData.append("purpose", "user_data");
  formData.append("file", blob, name);

  const response = await fetch("https://api.deepseek.com/files", {
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
  apiKey: string | null
): Promise<UploadedAttachment> {
  if (!apiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请先在设置中填写");
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
    const fileId = await uploadImageToDeepSeek(
      input.name,
      mimeType,
      buffer,
      apiKey
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
