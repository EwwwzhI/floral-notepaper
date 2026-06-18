import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import {
  createPendingImageFromFile,
  pendingImageMarkdown,
  type PendingImage,
} from "../features/images/pendingImages";
import {
  formatMarkdown,
  runEditorCommand,
  type FormatAction,
} from "../features/markdown/editorCommands";

const IMAGE_LINE_RE = /^!\[[^\]]*\]\(([^)]+)\)\s*$/;
const IMAGE_MIME_RE = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/;

interface ScratchMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onDirty: () => void;
  onAddPendingImages: (images: PendingImage[]) => void;
  onRemovePendingImage: (tempId: string) => void;
  pendingImages: Record<string, string>;
  imageBaseDir?: string;
  fontSize: number;
  fontFamily: string;
  placeholder: string;
  t: TFunction;
}

export interface ScratchMarkdownEditorHandle {
  format: (action: FormatAction) => void;
  undo: () => void;
  redo: () => void;
  focus: () => void;
}

interface TextBlock {
  type: "text";
  text: string;
  startLine: number;
  endLine: number;
}

interface ImageBlock {
  type: "image";
  src: string;
  line: string;
  lineIndex: number;
}

type ScratchBlock = TextBlock | ImageBlock;

function splitBlocks(value: string): ScratchBlock[] {
  const lines = value.split("\n");
  const blocks: ScratchBlock[] = [];
  let textStart = 0;
  let textLines: string[] = [];

  const flushText = (endLine: number) => {
    if (textLines.length === 0) return;
    blocks.push({ type: "text", text: textLines.join("\n"), startLine: textStart, endLine });
    textLines = [];
  };

  lines.forEach((line, index) => {
    const match = line.match(IMAGE_LINE_RE);
    if (match) {
      flushText(index - 1);
      blocks.push({ type: "image", src: match[1], line, lineIndex: index });
      textStart = index + 1;
      return;
    }

    if (textLines.length === 0) textStart = index;
    textLines.push(line);
  });

  flushText(lines.length - 1);
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: value, startLine: 0, endLine: 0 });
  }
  return blocks;
}

function offsetForLine(value: string, lineIndex: number): number {
  if (lineIndex <= 0) return 0;
  let offset = 0;
  let currentLine = 0;
  while (currentLine < lineIndex && offset < value.length) {
    const next = value.indexOf("\n", offset);
    if (next === -1) return value.length;
    offset = next + 1;
    currentLine += 1;
  }
  return offset;
}

function replaceLines(
  value: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const lines = value.split("\n");
  lines.splice(startLine, endLine - startLine + 1, ...replacement.split("\n"));
  return lines.join("\n");
}

function removeLine(value: string, lineIndex: number): string {
  const lines = value.split("\n");
  lines.splice(lineIndex, 1);
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
}

function resolveImageSrc(
  src: string,
  imageBaseDir: string | undefined,
  pendingImages: Record<string, string>,
) {
  if (src.startsWith("pending-image://")) {
    return pendingImages[src.slice("pending-image://".length)] ?? "";
  }
  if (src.startsWith("images/") && imageBaseDir) {
    return convertFileSrc(`${imageBaseDir}/${src}`);
  }
  return src;
}

function imageFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file" && IMAGE_MIME_RE.test(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function markdownInsertion(value: string, start: number, end: number, markdown: string) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leading = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const trailing = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  return `${before}${leading}${markdown}\n${trailing}${after}`;
}

export const ScratchMarkdownEditor = forwardRef<
  ScratchMarkdownEditorHandle,
  ScratchMarkdownEditorProps
>(function ScratchMarkdownEditor(
  {
    value,
    onChange,
    onDirty,
    onAddPendingImages,
    onRemovePendingImage,
    pendingImages,
    imageBaseDir,
    fontSize,
    fontFamily,
    placeholder,
    t,
  },
  ref,
) {
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeStartLineRef = useRef(0);
  const activeEndLineRef = useRef(0);
  const blocks = splitBlocks(value);

  const rememberTextarea = (
    textarea: HTMLTextAreaElement,
    startLine: number,
    endLine = startLine,
  ) => {
    activeTextareaRef.current = textarea;
    activeStartLineRef.current = startLine;
    activeEndLineRef.current = endLine;
  };

  const selectionForTextarea = (textarea: HTMLTextAreaElement, startLine: number) => {
    const lineOffset = offsetForLine(value, startLine);
    return {
      start: lineOffset + textarea.selectionStart,
      end: lineOffset + textarea.selectionEnd,
    };
  };

  const insertMarkdownAtTextarea = (markdown: string, textarea?: HTMLTextAreaElement | null) => {
    const target = textarea ?? activeTextareaRef.current;
    if (target) {
      const startLine = Number(target.dataset.startLine ?? activeStartLineRef.current ?? 0);
      const { start, end } = selectionForTextarea(target, startLine);
      onChange(markdownInsertion(value, start, end, markdown));
    } else {
      const prefix = value.trim() ? "\n" : "";
      onChange(`${value}${prefix}${markdown}\n`);
    }
    onDirty();
  };

  const processFiles = async (files: File[], textarea?: HTMLTextAreaElement | null) => {
    const images: PendingImage[] = [];
    for (const file of files) {
      const pending = await createPendingImageFromFile(file);
      if (pending) images.push(pending);
    }
    if (images.length === 0) return;
    onAddPendingImages(images);
    insertMarkdownAtTextarea(
      images.map((image) => pendingImageMarkdown(image.tempId)).join("\n"),
      textarea,
    );
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    const startLine = Number(event.currentTarget.dataset.startLine ?? 0);
    const endLine = Number(event.currentTarget.dataset.endLine ?? startLine);
    rememberTextarea(event.currentTarget, startLine, endLine);
    void processFiles(files, event.currentTarget);
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const startLine = Number(event.currentTarget.dataset.startLine ?? 0);
    const endLine = Number(event.currentTarget.dataset.endLine ?? startLine);
    rememberTextarea(event.currentTarget, startLine, endLine);
    void processFiles(files, event.currentTarget);
  };

  useImperativeHandle(ref, () => ({
    format(action) {
      const textarea = activeTextareaRef.current;
      const activeStartLine = activeStartLineRef.current;
      const selection = textarea
        ? selectionForTextarea(textarea, activeStartLine)
        : { start: 0, end: 0 };
      const hasSelection = selection.start !== selection.end;
      const result = formatMarkdown({
        value,
        selectionStart: selection.start,
        selectionEnd: selection.end,
        action,
        translate: t,
        noSelectionScope:
          action === "heading" || action.startsWith("heading")
            ? "currentLine"
            : hasSelection
              ? "placeholder"
              : "all",
      });
      onChange(result.text);
      onDirty();
      requestAnimationFrame(() => {
        const refreshed = activeTextareaRef.current;
        if (!refreshed) return;
        const lineOffset = offsetForLine(result.text, activeStartLineRef.current);
        const start = Math.max(0, result.cursorStart - lineOffset);
        const end = Math.max(0, result.cursorEnd - lineOffset);
        refreshed.focus();
        refreshed.setSelectionRange(start, end);
      });
    },
    undo() {
      const textarea = activeTextareaRef.current;
      if (runEditorCommand(textarea, "undo") && textarea) {
        onChange(
          replaceLines(value, activeStartLineRef.current, activeEndLineRef.current, textarea.value),
        );
        onDirty();
      }
    },
    redo() {
      const textarea = activeTextareaRef.current;
      if (runEditorCommand(textarea, "redo") && textarea) {
        onChange(
          replaceLines(value, activeStartLineRef.current, activeEndLineRef.current, textarea.value),
        );
        onDirty();
      }
    },
    focus() {
      activeTextareaRef.current?.focus();
    },
  }));

  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto scrollbar-hidden space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "image") {
          const src = resolveImageSrc(block.src, imageBaseDir, pendingImages);
          const tempId = block.src.startsWith("pending-image://")
            ? block.src.slice("pending-image://".length)
            : "";
          return (
            <div
              key={`${block.lineIndex}-${block.src}`}
              className="relative rounded-xl border border-paper-deep/35 bg-paper-warm/45 p-2"
            >
              {src ? (
                <img
                  src={src}
                  alt=""
                  className="max-h-48 max-w-full rounded-lg mx-auto object-contain"
                />
              ) : (
                <div className="h-24 flex items-center justify-center text-[12px] text-ink-ghost">
                  图片暂不可用
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  onChange(removeLine(value, block.lineIndex));
                  if (tempId) onRemovePendingImage(tempId);
                  onDirty();
                }}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-cloud/85 text-ink-ghost hover:text-red-400 hover:bg-danger-bg transition-colors cursor-pointer"
                aria-label="删除图片"
                title="删除图片"
              >
                ×
              </button>
            </div>
          );
        }

        return (
          <textarea
            key={`${block.startLine}-${index}`}
            data-tab-indent="true"
            data-start-line={block.startLine}
            data-end-line={block.endLine}
            value={block.text}
            onFocus={(event) =>
              rememberTextarea(event.currentTarget, block.startLine, block.endLine)
            }
            onSelect={(event) =>
              rememberTextarea(event.currentTarget, block.startLine, block.endLine)
            }
            onClick={(event) =>
              rememberTextarea(event.currentTarget, block.startLine, block.endLine)
            }
            onKeyUp={(event) =>
              rememberTextarea(event.currentTarget, block.startLine, block.endLine)
            }
            onChange={(event) => {
              rememberTextarea(event.currentTarget, block.startLine, block.endLine);
              onChange(replaceLines(value, block.startLine, block.endLine, event.target.value));
              onDirty();
            }}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            placeholder={index === 0 ? placeholder : undefined}
            className="w-full min-h-24 resize-none leading-relaxed text-ink-soft placeholder:text-ink-ghost/50 bg-transparent outline-none"
            data-scratch-editor-textarea="true"
            style={{ fontSize: `${fontSize}px`, fontFamily, tabSize: `var(--tab-indent-size, 2)` }}
            spellCheck={false}
          />
        );
      })}
    </div>
  );
});
