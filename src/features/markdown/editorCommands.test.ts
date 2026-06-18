import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import { formatMarkdown } from "./editorCommands";

const t = ((_: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? "") as TFunction;

describe("editor markdown commands", () => {
  test("wraps selected text in bold markers", () => {
    const result = formatMarkdown({
      value: "hello world",
      selectionStart: 6,
      selectionEnd: 11,
      action: "bold",
      translate: t,
    });

    expect(result.text).toBe("hello **world**");
    expect(result.cursorStart).toBe(8);
    expect(result.cursorEnd).toBe(13);
  });

  test("formats all content when no selection scope is all", () => {
    const result = formatMarkdown({
      value: "hello",
      selectionStart: 0,
      selectionEnd: 0,
      action: "italic",
      translate: t,
      noSelectionScope: "all",
    });

    expect(result.text).toBe("*hello*");
  });

  test("converts multiline content to tasks", () => {
    const result = formatMarkdown({
      value: "a\nb",
      selectionStart: 0,
      selectionEnd: 3,
      action: "todo",
      translate: t,
    });

    expect(result.text).toBe("- [ ] a\n- [ ] b");
  });

  test("toggles task checkbox states", () => {
    const result = formatMarkdown({
      value: "- [ ] a\n- [x] b",
      selectionStart: 0,
      selectionEnd: 15,
      action: "todoToggle",
      translate: t,
    });

    expect(result.text).toBe("- [x] a\n- [ ] b");
  });

  test("sets explicit heading level", () => {
    const result = formatMarkdown({
      value: "## Old title",
      selectionStart: 4,
      selectionEnd: 4,
      action: "heading3",
      translate: t,
    });

    expect(result.text).toBe("### Old title");
  });

  test("numbers selected lines", () => {
    const result = formatMarkdown({
      value: "a\nb",
      selectionStart: 0,
      selectionEnd: 3,
      action: "ol",
      translate: t,
    });

    expect(result.text).toBe("1. a\n2. b");
  });
});
