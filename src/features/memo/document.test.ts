import { describe, expect, test } from "vitest";
import {
  MEMO_CONTENT_PREFIX,
  createEmptyMemoContent,
  findMemoTextLinks,
  isMemoContent,
  legacyContentToMemoDocument,
  memoFormattedSegments,
  memoHasContent,
  memoLinkFromPastedText,
  memoPlainText,
  normalizeMemoLinkUrl,
  parseMemoContent,
  serializeMemoDocument,
  toggleMemoTextFormat,
  updateMemoBlockText,
} from "./document";

describe("memo document", () => {
  test("serializes and parses structured memo content", () => {
    const content = serializeMemoDocument({
      version: 1,
      blocks: [
        {
          id: "text-1",
          type: "text",
          text: "买菜",
          style: "body",
          format: { bold: true, underline: true },
          link: "https://example.com/market",
        },
        {
          id: "todo-1",
          type: "todo",
          text: "带环保袋",
          checked: true,
          format: { italic: true },
        },
      ],
    });

    expect(content.startsWith(MEMO_CONTENT_PREFIX)).toBe(true);
    expect(parseMemoContent(content).blocks).toEqual([
      {
        id: "text-1",
        type: "text",
        text: "买菜",
        style: "body",
        format: { bold: true, underline: true },
        link: "https://example.com/market",
      },
      {
        id: "todo-1",
        type: "todo",
        text: "带环保袋",
        checked: true,
        format: { italic: true },
      },
    ]);
    expect(memoPlainText(content)).toBe("买菜\n带环保袋");
  });

  test("applies formatting only to the selected text and keeps ranges while editing", () => {
    const block = {
      id: "text-1",
      type: "text" as const,
      text: "更新文档手册",
      style: "body" as const,
    };

    const formatted = toggleMemoTextFormat(block, 2, 4, "bold");
    expect(memoFormattedSegments(formatted)).toEqual([
      { start: 0, end: 2, text: "更新", format: {} },
      { start: 2, end: 4, text: "文档", format: { bold: true } },
      { start: 4, end: 6, text: "手册", format: {} },
    ]);

    const edited = updateMemoBlockText(formatted, "更新新文档手册");
    expect(memoFormattedSegments(edited)).toEqual([
      { start: 0, end: 3, text: "更新新", format: {} },
      { start: 3, end: 5, text: "文档", format: { bold: true } },
      { start: 5, end: 7, text: "手册", format: {} },
    ]);
  });

  test("preserves partial links in formatting ranges", () => {
    const content = serializeMemoDocument({
      version: 1,
      blocks: [
        {
          id: "text",
          type: "text",
          text: "查看文档",
          style: "body",
          formats: [{ start: 2, end: 4, format: { link: "https://example.com/docs" } }],
        },
      ],
    });

    const block = parseMemoContent(content).blocks[0];
    expect(block.type === "text" ? memoFormattedSegments(block) : []).toEqual([
      { start: 0, end: 2, text: "查看", format: {} },
      {
        start: 2,
        end: 4,
        text: "文档",
        format: { link: "https://example.com/docs" },
      },
    ]);
  });

  test("normalizes supported links and rejects unsafe protocols", () => {
    expect(normalizeMemoLinkUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeMemoLinkUrl("hello@example.com")).toBe("mailto:hello@example.com");
    expect(normalizeMemoLinkUrl("javascript:alert(1)")).toBeNull();
  });

  test("detects links in pasted text and inside ordinary sentences", () => {
    expect(memoLinkFromPastedText(" example.com/docs ")).toBe("https://example.com/docs");
    expect(memoLinkFromPastedText("查看 example.com/docs")).toBeNull();
    expect(
      findMemoTextLinks("查看 https://example.com/docs，然后发邮件给 hi@example.com。"),
    ).toEqual([
      {
        start: 3,
        end: 27,
        text: "https://example.com/docs",
        url: "https://example.com/docs",
      },
      {
        start: 35,
        end: 49,
        text: "hi@example.com",
        url: "mailto:hi@example.com",
      },
    ]);
  });

  test("converts a standalone legacy Markdown link into a linked text block", () => {
    expect(legacyContentToMemoDocument("[项目主页](https://example.com)").blocks[0]).toMatchObject({
      type: "text",
      text: "项目主页",
      link: "https://example.com",
    });
  });

  test("converts legacy Markdown tasks, headings, and images into memo blocks", () => {
    const document = legacyContentToMemoDocument(
      "# 周末\n\n- [ ] 买花\n- [x] 浇水\n\n![](images/note/photo.png)",
    );

    expect(document.blocks.map((block) => block.type)).toEqual(["text", "todo", "todo", "image"]);
    expect(document.blocks[0]).toMatchObject({ type: "text", text: "周末", style: "heading" });
    expect(document.blocks[2]).toMatchObject({ type: "todo", text: "浇水", checked: true });
    expect(document.blocks[3]).toMatchObject({
      type: "image",
      src: "images/note/photo.png",
    });
  });

  test("creates an empty structured memo without reporting visible content", () => {
    const content = createEmptyMemoContent();
    expect(isMemoContent(content)).toBe(true);
    expect(memoHasContent(content)).toBe(false);
    expect(parseMemoContent(content).blocks).toHaveLength(1);
  });

  test("does not hide malformed prefixed content as an empty memo", () => {
    const content = `${MEMO_CONTENT_PREFIX}{invalid`;

    expect(isMemoContent(content)).toBe(false);
    expect(memoPlainText(content)).toContain("{invalid");
  });
});
