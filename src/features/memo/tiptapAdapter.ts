import type { JSONContent } from "@tiptap/core";
import {
  createMemoBlockId,
  memoFormattedSegments,
  normalizeMemoLinkUrl,
  type MemoDocument,
  type MemoFormatRange,
  type MemoTextBlock,
  type MemoTextFormat,
  type MemoTodoBlock,
} from "./document";

export type MemoImageResolver = (src: string) => string;

type TiptapMark = NonNullable<JSONContent["marks"]>[number];

function marksForFormat(format: MemoTextFormat, fallbackLink?: string): TiptapMark[] {
  const marks: TiptapMark[] = [];
  if (format.bold) marks.push({ type: "bold" });
  if (format.italic) marks.push({ type: "italic" });
  if (format.underline) marks.push({ type: "underline" });
  const link = normalizeMemoLinkUrl(format.link ?? fallbackLink);
  if (link) marks.push({ type: "link", attrs: { href: link } });
  return marks;
}

function inlineContent(block: MemoTextBlock | MemoTodoBlock): JSONContent[] | undefined {
  if (!block.text) return undefined;
  return memoFormattedSegments(block).map((segment) => {
    const marks = marksForFormat(segment.format, block.link);
    return {
      type: "text",
      text: segment.text,
      ...(marks.length > 0 ? { marks } : {}),
    };
  });
}

export function memoDocumentToTiptap(
  document: MemoDocument,
  resolveImage: MemoImageResolver = (src) => src,
): JSONContent {
  const content: JSONContent[] = [];
  let index = 0;

  while (index < document.blocks.length) {
    const block = document.blocks[index];
    if (block.type === "todo") {
      const items: JSONContent[] = [];
      while (index < document.blocks.length && document.blocks[index].type === "todo") {
        const todo = document.blocks[index] as MemoTodoBlock;
        items.push({
          type: "taskItem",
          attrs: { checked: todo.checked, blockId: todo.id },
          content: [{ type: "paragraph", content: inlineContent(todo) }],
        });
        index += 1;
      }
      content.push({ type: "taskList", content: items });
      continue;
    }

    if (block.type === "image") {
      content.push({
        type: "image",
        attrs: {
          src: resolveImage(block.src),
          storageSrc: block.src,
          alt: block.alt ?? null,
          title: null,
          blockId: block.id,
          align: block.align ?? "center",
        },
      });
    } else {
      content.push({
        type: block.style === "heading" ? "heading" : "paragraph",
        attrs: {
          blockId: block.id,
          ...(block.style === "heading" ? { level: 2 } : {}),
        },
        content: inlineContent(block),
      });
    }
    index += 1;
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

function formatFromMarks(marks: TiptapMark[] | undefined): MemoTextFormat {
  const format: MemoTextFormat = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold") format.bold = true;
    else if (mark.type === "italic") format.italic = true;
    else if (mark.type === "underline") format.underline = true;
    else if (mark.type === "link" && typeof mark.attrs?.href === "string") {
      format.link = normalizeMemoLinkUrl(mark.attrs.href) ?? undefined;
    }
  }
  return format;
}

function sameFormat(left: MemoTextFormat, right: MemoTextFormat) {
  return (
    Boolean(left.bold) === Boolean(right.bold) &&
    Boolean(left.italic) === Boolean(right.italic) &&
    Boolean(left.underline) === Boolean(right.underline) &&
    left.link === right.link
  );
}

function textAndFormats(node: JSONContent): { text: string; formats?: MemoFormatRange[] } {
  let text = "";
  const ranges: MemoFormatRange[] = [];

  const append = (value: string, format: MemoTextFormat) => {
    if (!value) return;
    const start = text.length;
    text += value;
    if (!format.bold && !format.italic && !format.underline && !format.link) return;
    const previous = ranges[ranges.length - 1];
    if (previous && previous.end === start && sameFormat(previous.format, format)) {
      previous.end = text.length;
    } else {
      ranges.push({ start, end: text.length, format });
    }
  };

  const visit = (child: JSONContent) => {
    if (child.type === "text") append(child.text ?? "", formatFromMarks(child.marks));
    else if (child.type === "hardBreak") append("\n", {});
    else child.content?.forEach(visit);
  };
  node.content?.forEach(visit);
  return { text, formats: ranges.length > 0 ? ranges : undefined };
}

function blockId(node: JSONContent): string {
  return typeof node.attrs?.blockId === "string" && node.attrs.blockId
    ? node.attrs.blockId
    : createMemoBlockId();
}

export function tiptapToMemoDocument(content: JSONContent): MemoDocument {
  const blocks: MemoDocument["blocks"] = [];

  for (const node of content.content ?? []) {
    if (node.type === "taskList") {
      for (const item of node.content ?? []) {
        if (item.type !== "taskItem") continue;
        const paragraph = item.content?.find((child) => child.type === "paragraph") ?? item;
        const formatted = textAndFormats(paragraph);
        blocks.push({
          id: blockId(item),
          type: "todo",
          text: formatted.text,
          checked: item.attrs?.checked === true,
          formats: formatted.formats,
        });
      }
      continue;
    }

    if (node.type === "image") {
      const storageSrc = node.attrs?.storageSrc;
      const src = typeof storageSrc === "string" ? storageSrc : node.attrs?.src;
      if (typeof src === "string" && src) {
        blocks.push({
          id: blockId(node),
          type: "image",
          src,
          alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : undefined,
          align:
            node.attrs?.align === "left" || node.attrs?.align === "right"
              ? node.attrs.align
              : undefined,
        });
      }
      continue;
    }

    if (node.type === "paragraph" || node.type === "heading") {
      const formatted = textAndFormats(node);
      blocks.push({
        id: blockId(node),
        type: "text",
        text: formatted.text,
        style: node.type === "heading" ? "heading" : "body",
        formats: formatted.formats,
      });
    }
  }

  return {
    version: 1,
    blocks:
      blocks.length > 0
        ? blocks
        : [{ id: createMemoBlockId(), type: "text", text: "", style: "body" }],
  };
}
