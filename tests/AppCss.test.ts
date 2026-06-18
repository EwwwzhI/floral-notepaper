import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("app font stacks", () => {
  test("uses the platform font stack for monospace UI text", () => {
    const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

    expect(css).toMatch(/--font-mono:[\s\S]*monospace;/);
    expect(css).not.toContain("HarmonyOS Sans SC");
  });
});
