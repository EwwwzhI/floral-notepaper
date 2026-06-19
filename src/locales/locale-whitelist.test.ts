import { describe, expect, test } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveAppLocale,
} from "./locale-whitelist";

describe("locale whitelist", () => {
  test("keeps the application fixed to Simplified Chinese", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN"]);
    expect(normalizeLocale("en-US")).toBe("zh-CN");
    expect(normalizeLocale(undefined)).toBeNull();
    expect(resolveAppLocale()).toBe("zh-CN");
  });
});
