import { describe, expect, test } from "vitest";
import { DEFAULT_NOTE_FONT, normalizeNoteFontFamily, resolveNoteFontFamily } from "./fonts";

describe("settings fonts", () => {
  test("uses the current system font by default", () => {
    expect(normalizeNoteFontFamily("system")).toBe("system");
    expect(normalizeNoteFontFamily(undefined)).toBe(DEFAULT_NOTE_FONT);
  });

  test("keeps system font choices", () => {
    expect(normalizeNoteFontFamily("system:Arial")).toBe("system:Arial");
  });

  test("falls back for removed font modes", () => {
    expect(normalizeNoteFontFamily("builtin:serif")).toBe(DEFAULT_NOTE_FONT);
    expect(normalizeNoteFontFamily("custom:font-1")).toBe(DEFAULT_NOTE_FONT);
    expect(normalizeNoteFontFamily("unknown")).toBe(DEFAULT_NOTE_FONT);
  });

  test("resolves font-family css values", () => {
    expect(resolveNoteFontFamily("system")).toContain("system-ui");
    expect(resolveNoteFontFamily("system:Arial")).toContain("Arial");
  });
});
