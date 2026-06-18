import type { NoteFontFamily } from "./types";

export const DEFAULT_NOTE_FONT: NoteFontFamily = "system";

const SYSTEM_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function quoteFontFamily(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function normalizeNoteFontFamily(value: string | undefined): NoteFontFamily {
  if (value === "system") return value;

  if (value?.startsWith("system:") && value.slice("system:".length).trim()) {
    return value as NoteFontFamily;
  }

  return DEFAULT_NOTE_FONT;
}

export function resolveNoteFontFamily(value: string | undefined): string {
  const normalized = normalizeNoteFontFamily(value);
  if (normalized.startsWith("system:")) {
    return `${quoteFontFamily(normalized.slice("system:".length))}, ${SYSTEM_FONT_FAMILY}`;
  }
  return SYSTEM_FONT_FAMILY;
}

export function applyAppFont(value: string | undefined): void {
  if (typeof document === "undefined") return;
  const fontFamily = resolveNoteFontFamily(value);
  document.documentElement.style.setProperty("--font-body", fontFamily);
  document.documentElement.style.setProperty("--font-display", fontFamily);
}
