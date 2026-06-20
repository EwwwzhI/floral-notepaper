import { describe, expect, it } from "vitest";
import type { MemoDocument } from "./document";
import { memoDocumentToTiptap, tiptapToMemoDocument } from "./tiptapAdapter";

describe("memo Tiptap adapter", () => {
  it("round-trips text formats, partial links, todos, images and block ids", () => {
    const document: MemoDocument = {
      version: 1,
      blocks: [
        {
          id: "heading",
          type: "text",
          text: "花笺🌿",
          style: "heading",
          formats: [
            { start: 0, end: 2, format: { bold: true } },
            { start: 2, end: 4, format: { link: "https://example.com" } },
          ],
        },
        { id: "todo-a", type: "todo", text: "第一项", checked: false },
        {
          id: "todo-b",
          type: "todo",
          text: "第二项",
          checked: true,
          formats: [{ start: 0, end: 3, format: { italic: true, underline: true } }],
        },
        {
          id: "image",
          type: "image",
          src: "images/moon.png",
          alt: "月亮",
          align: "right",
        },
        { id: "empty", type: "text", text: "", style: "body" },
      ],
    };

    const tiptap = memoDocumentToTiptap(document, (src) => `asset://${src}`);
    expect(tiptap.content?.[1].type).toBe("taskList");
    expect(tiptap.content?.[2].attrs).toMatchObject({
      src: "asset://images/moon.png",
      storageSrc: "images/moon.png",
      blockId: "image",
      align: "right",
    });

    expect(tiptapToMemoDocument(tiptap)).toEqual(document);
  });

  it("creates ids for new Tiptap blocks", () => {
    const document = tiptapToMemoDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "新增内容" }] }],
    });

    expect(document.blocks[0]).toMatchObject({ type: "text", text: "新增内容", style: "body" });
    expect(document.blocks[0].id).toMatch(/^memo-/);
  });
});
