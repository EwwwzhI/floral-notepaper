import { describe, expect, test } from "vitest";
import {
  NOTE_SURFACE_MODE_EVENT,
  SURFACE_WINDOW_SIZES,
  getAutoSizedTileBounds,
  getSurfaceTargetBounds,
  isNoteSurfaceMode,
} from "./surfaceMode";

describe("surface mode helpers", () => {
  test("keeps surface modes explicit", () => {
    expect(isNoteSurfaceMode("pad")).toBe(true);
    expect(isNoteSurfaceMode("tile")).toBe(true);
    expect(isNoteSurfaceMode("main")).toBe(false);
    expect(NOTE_SURFACE_MODE_EVENT).toBe("floral-notepaper:surface-mode");
  });

  test("keeps the current window bounds when switching surface modes", () => {
    const current = {
      x: 100,
      y: 80,
      width: 420,
      height: 430,
    };
    const target = getSurfaceTargetBounds("tile", {
      ...current,
    });

    expect(SURFACE_WINDOW_SIZES.tile).toEqual(SURFACE_WINDOW_SIZES.pad);
    expect(SURFACE_WINDOW_SIZES.pad).toEqual({ width: 260, height: 260 });
    expect(target).toEqual(current);
  });

  test("auto-sizes tile height without changing its width and keeps it in the work area", () => {
    const target = getAutoSizedTileBounds({ x: 100, y: 700, width: 520, height: 520 }, 360, 1.5, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });

    expect(target).toEqual({ x: 100, y: 540, width: 520, height: 540 });
  });

  test("caps oversized tile content to the monitor work area", () => {
    const target = getAutoSizedTileBounds({ x: 20, y: 40, width: 300, height: 260 }, 1600, 1, {
      x: 0,
      y: 30,
      width: 1200,
      height: 800,
    });

    expect(target).toEqual({ x: 20, y: 30, width: 300, height: 800 });
  });

  test("uses the native minimum height for short tile content", () => {
    const target = getAutoSizedTileBounds({ x: 20, y: 40, width: 300, height: 500 }, 80, 1);

    expect(target).toEqual({ x: 20, y: 40, width: 300, height: 220 });
  });
});
