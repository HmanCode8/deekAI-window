// 附件 / 消息 / 模型相关类型与工具（前后端共享，与网页版 lib/attachments.ts 同源）
export type Role = "user" | "assistant";

export type AttachmentKind = "image" | "document";

export interface UploadedAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  fileId?: string;
  extractedText?: string;
  truncated?: boolean;
}

export interface ChatMessage {
  role: Role;
  content: string;
  attachments?: UploadedAttachment[];
}

export const MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  {
    id: "deepseek-v4-flash-vision-exp",
    label: "DeepSeek V4 Flash Vision (Exp)",
  },
] as const;

export const VISION_MODEL_ID = "deepseek-v4-flash-vision-exp";

export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cpp",
  "h",
  "hpp",
  "sql",
  "log",
  "ini",
  "env",
]);

export function getFileExtension(filename: string) {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

export function isSupportedImage(file: { type?: string; name: string }) {
  if (file.type && IMAGE_MIME_TYPES.has(file.type)) {
    return true;
  }

  return ["jpg", "jpeg", "png", "gif", "webp"].includes(
    getFileExtension(file.name)
  );
}

export function isSupportedTextDocument(file: { type?: string; name: string }) {
  const extension = getFileExtension(file.name);

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  return Boolean(file.type?.startsWith("text/"));
}

export function isPdf(file: { type?: string; name: string }) {
  return (
    file.type === "application/pdf" || getFileExtension(file.name) === "pdf"
  );
}

export function isDocx(file: { type?: string; name: string }) {
  return (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    getFileExtension(file.name) === "docx"
  );
}
