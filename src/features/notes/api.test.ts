import { describe, expect, test } from "vitest";
import { getErrorMessage, markdownExportFileName } from "./api";

describe("Markdown export", () => {
  test("creates a safe Markdown file name from the note title", () => {
    expect(markdownExportFileName('  周报: "六月" / 草稿  ')).toBe("周报_六月_草稿.md");
    expect(markdownExportFileName("...")).toBe("无标题便签.md");
  });
});

describe("notes api error localization", () => {
  test("localizes structured backend errors with interpolation details", () => {
    expect(
      getErrorMessage({
        code: "categoryAlreadyExists",
        message: "分类「工作」已存在",
        details: { category: "工作" },
      }),
    ).toBe("分类「工作」已存在");
  });

  test("localizes shortcut configuration errors with settings labels", () => {
    expect(
      getErrorMessage({
        code: "unsupportedShortcut",
        message: "unsupported globalShortcut shortcut config: Ctrl+",
        details: { field: "globalShortcut" },
      }),
    ).toBe("快捷便签快捷键 配置无效");
  });

  test("parses serialized backend error strings when a structured payload is unavailable", () => {
    expect(getErrorMessage("noteNotFound: Note note-1 was not found")).toBe("找不到该便签");
  });

  test("localizes serialized category errors when interpolation details can be recovered", () => {
    expect(getErrorMessage("categoryNotFound: 分类「工作」不存在")).toBe("分类「工作」不存在");
    expect(getErrorMessage("categoryAlreadyExists: 分类「工作」已存在")).toBe("分类「工作」已存在");
  });

  test("falls back to the backend message for unknown error codes", () => {
    expect(
      getErrorMessage({
        code: "mysteryError",
        message: "something went wrong",
      }),
    ).toBe("something went wrong");
  });
});
