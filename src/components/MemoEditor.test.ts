// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { clipboardPlainText, createMemoEditorExtensions } from "./MemoEditor";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("MemoEditor Tiptap commands", () => {
  it("formats a selection that crosses paragraph boundaries", () => {
    editor = new Editor({
      extensions: createMemoEditorExtensions("请输入内容"),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "a" },
            content: [{ type: "text", text: "第一段" }],
          },
          {
            type: "paragraph",
            attrs: { blockId: "b" },
            content: [{ type: "text", text: "第二段" }],
          },
        ],
      },
    });

    editor.commands.setTextSelection({ from: 2, to: 7 });
    expect(editor.commands.toggleBold()).toBe(true);

    const paragraphs = editor.getJSON().content ?? [];
    expect(
      paragraphs[0].content?.some((node) => node.marks?.some((mark) => mark.type === "bold")),
    ).toBe(true);
    expect(
      paragraphs[1].content?.some((node) => node.marks?.some((mark) => mark.type === "bold")),
    ).toBe(true);
  });

  it("serializes mixed paragraphs and task items as useful plain text", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<p>正文</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>未完成</p></div></li><li data-type="taskItem" data-checked="true"><div><p>已完成</p></div></li></ul>';

    expect(clipboardPlainText(wrapper)).toBe("正文\n\n- [ ] 未完成\n- [x] 已完成");
  });

  it("toggles selected paragraphs into a task list", () => {
    editor = new Editor({
      extensions: createMemoEditorExtensions("请输入内容"),
      content: "<p>第一项</p><p>第二项</p>",
    });
    editor.commands.selectAll();

    expect(editor.commands.toggleTaskList()).toBe(true);
    expect(editor.getJSON().content?.[0].type).toBe("taskList");
    expect(editor.getJSON().content?.[0].content).toHaveLength(2);
  });
});
