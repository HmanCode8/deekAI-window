/**
 * 本机用户资料（头像）：
 * 头像压缩为 144x144 的 JPEG dataURL 后用 localStorage 保存，按用户隔离。
 * 桌面端渲染进程同样有 localStorage（存在 userData 目录），因此双端通用、无需后端。
 *
 * 注意：这里通过 FileReader 读取为 data: URL 再解码，
 * 不使用 URL.createObjectURL(blob:)，避免被应用 CSP 的 img-src 限制拦截。
 */
import { useEffect, useState } from "react";

const AVATAR_KEY_PREFIX = "deekai:avatar:";

/** 头像变更事件：设置面板上传后，聊天区头像可即时刷新（无需刷新页面） */
export const AVATAR_CHANGED_EVENT = "deekai:avatar-changed";

function avatarKey(userId: string | null): string {
  return AVATAR_KEY_PREFIX + (userId ?? "local");
}

export function loadAvatar(userId: string | null): string | null {
  try {
    return localStorage.getItem(avatarKey(userId));
  } catch {
    return null;
  }
}

export function saveAvatar(userId: string | null, dataUrl: string | null): void {
  try {
    if (dataUrl) {
      localStorage.setItem(avatarKey(userId), dataUrl);
    } else {
      localStorage.removeItem(avatarKey(userId));
    }
  } catch {
    // 忽略写入失败（隐私模式/容量限制）
  }
  window.dispatchEvent(
    new CustomEvent(AVATAR_CHANGED_EVENT, { detail: { userId } })
  );
}

/** 订阅当前用户头像（设置面板修改后会自动同步） */
export function useAvatar(userId: string | null): string | null {
  const [avatar, setAvatar] = useState<string | null>(() => loadAvatar(userId));

  useEffect(() => {
    setAvatar(loadAvatar(userId));
    const onChange = () => setAvatar(loadAvatar(userId));
    window.addEventListener(AVATAR_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onChange);
  }, [userId]);

  return avatar;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败，请更换图片"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error("图片无法解析（可能是 HEIC/SVG 等格式），请换一张 JPG/PNG 图片")
      );
    image.src = src;
  });
}

/** 读取图片文件 -> 居中裁剪为正方形 -> 缩放到指定尺寸的 JPEG dataURL */
export async function fileToAvatarDataUrl(
  file: File,
  size = 144
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const sourceDataUrl = await readAsDataUrl(file);
  const image = await loadImage(sourceDataUrl);

  if (!image.width || !image.height) {
    throw new Error("图片尺寸异常，请更换图片");
  }

  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前环境不支持图片处理");

  // 白底填充：避免带透明通道的图片被压成黑底
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", 0.85);
}
