import type { WindowBounds } from "./api";

export type NoteSurfaceMode = "pad" | "tile";

export const NOTE_SURFACE_MODE_EVENT = "floral-notepaper:surface-mode";

export const SURFACE_WINDOW_SIZES: Record<
  NoteSurfaceMode,
  Pick<WindowBounds, "width" | "height">
> = {
  pad: { width: 260, height: 260 },
  tile: { width: 260, height: 260 },
};

const SURFACE_WINDOW_MIN_HEIGHT = 220;

export function isNoteSurfaceMode(value: unknown): value is NoteSurfaceMode {
  return value === "pad" || value === "tile";
}

export function getSurfaceTargetBounds(
  _mode: NoteSurfaceMode,
  current: WindowBounds,
): WindowBounds {
  return current;
}

export function getAutoSizedTileBounds(
  current: WindowBounds,
  contentHeight: number,
  scaleFactor: number,
  workArea?: WindowBounds,
): WindowBounds {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const minimumHeight = Math.round(SURFACE_WINDOW_MIN_HEIGHT * scale);
  let height = Math.max(minimumHeight, Math.ceil(contentHeight * scale));
  let y = current.y;

  if (workArea) {
    height = Math.min(height, workArea.height);
    const maximumY = workArea.y + workArea.height - height;
    y = Math.min(Math.max(y, workArea.y), maximumY);
  }

  return { ...current, y, height };
}

export function requestSurfaceMode(mode: NoteSurfaceMode): void {
  window.dispatchEvent(new CustomEvent(NOTE_SURFACE_MODE_EVENT, { detail: { mode } }));
}

export function surfaceModeFromEvent(event: Event): NoteSurfaceMode | null {
  if (!(event instanceof CustomEvent)) return null;
  const mode = (event.detail as { mode?: unknown } | null)?.mode;
  return isNoteSurfaceMode(mode) ? mode : null;
}
