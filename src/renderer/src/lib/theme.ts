import { useCallback, useEffect, useState } from "react";

/**
 * 主题：light / dark / system（跟随系统）。
 * 通过 documentElement.dataset.theme 切换，样式见 globals.css 的深色覆盖块。
 * 持久化在 localStorage（桌面端渲染进程同样可用）。
 */

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "deekai:theme";

export function getThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // 隐私模式等场景忽略
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => getThemeMode());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(getThemeMode())
  );

  useEffect(() => {
    applyTheme(mode);
    setResolved(resolveTheme(mode));

    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      setResolved(resolveTheme("system"));
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
    setModeState(next);
  }, []);

  return { mode, resolved, setMode };
}

/** 快捷切换顺序：light -> dark -> system -> light */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === "light") return "dark";
  if (mode === "dark") return "system";
  return "light";
}

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};
