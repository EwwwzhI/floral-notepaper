import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { createPendingImageFromFile, type PendingImage } from "../features/images/pendingImages";
import {
  createEmptyMemoDocument,
  createMemoBlockId,
  findMemoTextLinks,
  memoLinkFromPastedText,
  normalizeMemoLinkUrl,
  parseMemoContent,
  serializeMemoDocument,
  type MemoBlock,
  type MemoDocument,
  type MemoImageBlock,
  type MemoTextBlock,
  type MemoTextFormat,
  type MemoTodoBlock,
} from "../features/memo/document";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const IMAGE_MIME_RE = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/;

interface MemoEditorProps {
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
  disabled?: boolean;
  compact?: boolean;
  showToolbar?: boolean;
  onError?: (message: string) => void;
}

export interface MemoEditorHandle {
  undo: () => void;
  redo: () => void;
  focus: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleTodo: () => void;
  openImagePicker: () => void;
  insertImages: (images: PendingImage[]) => void;
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

function dataTransferImageFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file" && IMAGE_MIME_RE.test(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function withoutEmptyPlaceholder(blocks: MemoBlock[]): MemoBlock[] {
  if (
    blocks.length === 1 &&
    blocks[0].type === "text" &&
    blocks[0].style === "body" &&
    !blocks[0].text
  ) {
    return [];
  }
  return blocks;
}

function nextDocument(blocks: MemoBlock[]): MemoDocument {
  return blocks.length > 0 ? { version: 1, blocks } : createEmptyMemoDocument();
}

export const MemoEditor = forwardRef<MemoEditorHandle, MemoEditorProps>(function MemoEditor(
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
    disabled = false,
    compact = false,
    showToolbar = true,
    onError,
  },
  ref,
) {
  const { t } = useTranslation();
  const document = useMemo(() => parseMemoContent(value), [value]);
  const documentRef = useRef(document);
  documentRef.current = document;
  const activeBlockIdRef = useRef(document.blocks[0]?.id ?? "");
  const inputRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const lastEmittedRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastEmittedRef.current === value) return;
    undoStackRef.current = [];
    redoStackRef.current = [];
    activeBlockIdRef.current = document.blocks[0]?.id ?? "";
  }, [document.blocks, value]);

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      const textarea = inputRefs.current.get(id);
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [value]);

  const emitDocument = (next: MemoDocument, recordHistory = true) => {
    if (disabled) return;
    const currentSerialized = serializeMemoDocument(documentRef.current);
    const serialized = serializeMemoDocument(next);
    if (serialized === currentSerialized) return;
    if (recordHistory) {
      undoStackRef.current.push(currentSerialized);
      if (undoStackRef.current.length > 80) undoStackRef.current.shift();
      redoStackRef.current = [];
    }
    documentRef.current = next;
    lastEmittedRef.current = serialized;
    onChange(serialized);
    onDirty();
  };

  const updateBlock = (id: string, update: (block: MemoBlock) => MemoBlock) => {
    emitDocument(
      nextDocument(
        documentRef.current.blocks.map((block) => (block.id === id ? update(block) : block)),
      ),
    );
  };

  const insertBlocks = (blocks: MemoBlock[]) => {
    const current = withoutEmptyPlaceholder(documentRef.current.blocks);
    const activeIndex = current.findIndex((block) => block.id === activeBlockIdRef.current);
    const insertionIndex = activeIndex >= 0 ? activeIndex + 1 : current.length;
    const nextBlocks = [...current];
    nextBlocks.splice(insertionIndex, 0, ...blocks);
    pendingFocusRef.current =
      blocks.find((block) => block.type === "text" || block.type === "todo")?.id ?? null;
    emitDocument(nextDocument(nextBlocks));
  };

  const addTodo = () => {
    insertBlocks([
      { id: createMemoBlockId(), type: "todo", text: "", checked: false } satisfies MemoTodoBlock,
    ]);
  };

  const toggleActiveTodo = () => {
    const activeId = activeBlockIdRef.current;
    const active = documentRef.current.blocks.find((block) => block.id === activeId);
    if (!active || active.type === "image") return;

    updateBlock(activeId, (block) => {
      if (block.type === "image") return block;
      return block.type === "todo"
        ? ({
            id: block.id,
            type: "text",
            text: block.text,
            style: "body",
            format: block.format,
            link: block.link,
          } satisfies MemoTextBlock)
        : ({
            id: block.id,
            type: "todo",
            text: block.text,
            checked: false,
            format: block.format,
            link: block.link,
          } satisfies MemoTodoBlock);
    });
    pendingFocusRef.current = activeId;
  };

  const toggleActiveFormat = (key: keyof MemoTextFormat) => {
    const activeId = activeBlockIdRef.current;
    const active = documentRef.current.blocks.find((block) => block.id === activeId);
    if (!active || active.type === "image") return;

    updateBlock(activeId, (block) => {
      if (block.type === "image") return block;
      return {
        ...block,
        format: {
          ...block.format,
          [key]: !block.format?.[key],
        },
      };
    });
    pendingFocusRef.current = activeId;
  };

  const openStoredLink = (value: string) => {
    const link = normalizeMemoLinkUrl(value);
    if (link) void openUrl(link);
  };

  const insertImages = (images: PendingImage[]) => {
    if (images.length === 0) return;
    onAddPendingImages(images);
    insertBlocks(
      images.map(
        (image) =>
          ({
            id: createMemoBlockId(),
            type: "image",
            src: `pending-image://${image.tempId}`,
            alt: image.fileName,
          }) satisfies MemoImageBlock,
      ),
    );
  };

  const processFiles = async (files: File[]) => {
    try {
      const images: PendingImage[] = [];
      for (const file of files) {
        if (file.size > MAX_IMAGE_SIZE) {
          throw new Error(
            t("errors.imageTooLarge", { defaultValue: "图片文件过大（上限 20 MB）" }),
          );
        }
        const image = await createPendingImageFromFile(file);
        if (image) images.push(image);
      }
      insertImages(images);
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : t("errors.imagePasteFailed", { defaultValue: "图片导入失败" }),
      );
    }
  };

  const removeBlock = (block: MemoBlock) => {
    const pendingImageId =
      block.type === "image" && block.src.startsWith("pending-image://")
        ? block.src.slice("pending-image://".length)
        : null;
    if (pendingImageId) {
      onRemovePendingImage(pendingImageId);
      const pendingReference = `pending-image://${pendingImageId}`;
      undoStackRef.current = undoStackRef.current.filter(
        (entry) => !entry.includes(pendingReference),
      );
      redoStackRef.current = redoStackRef.current.filter(
        (entry) => !entry.includes(pendingReference),
      );
    }
    const index = documentRef.current.blocks.findIndex((item) => item.id === block.id);
    const nextBlocks = documentRef.current.blocks.filter((item) => item.id !== block.id);
    const next = nextDocument(nextBlocks);
    const focusTarget = next.blocks[Math.max(0, index - 1)];
    pendingFocusRef.current = focusTarget && focusTarget.type !== "image" ? focusTarget.id : null;
    emitDocument(next, pendingImageId === null);
  };

  const handleTodoKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, block: MemoTodoBlock) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      activeBlockIdRef.current = block.id;
      addTodo();
      return;
    }
    if (event.key === "Backspace" && !block.text && documentRef.current.blocks.length > 1) {
      event.preventDefault();
      removeBlock(block);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = dataTransferImageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void processFiles(files);
  };

  const handleTextPaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
    block: MemoTextBlock | MemoTodoBlock,
  ) => {
    if (disabled || dataTransferImageFiles(event.clipboardData).length > 0) return;
    const pastedText = event.clipboardData.getData("text/plain");
    const link = memoLinkFromPastedText(pastedText);
    if (!link) return;

    const textarea = event.currentTarget;
    const entireBlockSelected =
      textarea.selectionStart === 0 && textarea.selectionEnd === block.text.length;
    if (block.text && !entireBlockSelected) return;

    event.preventDefault();
    const selectedText = block.text.slice(textarea.selectionStart, textarea.selectionEnd);
    updateBlock(block.id, (current) =>
      current.type === "image"
        ? current
        : {
            ...current,
            text: selectedText || pastedText.trim(),
            link,
          },
    );
    pendingFocusRef.current = block.id;
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = dataTransferImageFiles(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    void processFiles(files);
  };

  const undo = () => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(serializeMemoDocument(documentRef.current));
    const previousDocument = parseMemoContent(previous);
    documentRef.current = previousDocument;
    lastEmittedRef.current = previous;
    onChange(previous);
    onDirty();
  };

  const redo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(serializeMemoDocument(documentRef.current));
    const nextMemo = parseMemoContent(next);
    documentRef.current = nextMemo;
    lastEmittedRef.current = next;
    onChange(next);
    onDirty();
  };

  useImperativeHandle(ref, () => ({
    undo,
    redo,
    focus() {
      const active =
        inputRefs.current.get(activeBlockIdRef.current) ?? inputRefs.current.values().next().value;
      active?.focus();
    },
    toggleBold() {
      toggleActiveFormat("bold");
    },
    toggleItalic() {
      toggleActiveFormat("italic");
    },
    toggleUnderline() {
      toggleActiveFormat("underline");
    },
    toggleTodo: toggleActiveTodo,
    openImagePicker() {
      fileInputRef.current?.click();
    },
    insertImages,
  }));

  return (
    <div
      className={`memo-editor ${compact ? "memo-editor-compact" : ""}`}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={(event) => {
        if (
          Array.from(event.dataTransfer.items).some(
            (item) => item.kind === "file" && IMAGE_MIME_RE.test(item.type),
          )
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === "y") {
          event.preventDefault();
          redo();
        }
      }}
      data-memo-editor="true"
    >
      <div className="memo-editor-canvas">
        {document.blocks.map((block, index) => {
          if (block.type === "image") {
            const src = resolveImageSrc(block.src, imageBaseDir, pendingImages);
            return (
              <figure
                key={block.id}
                className={`memo-image-block group ${src ? "" : "is-missing"}`}
              >
                {src ? (
                  <img src={src} alt={block.alt ?? ""} className="memo-image" draggable={false} />
                ) : (
                  <div className="memo-image-missing">
                    {t("memo.imageUnavailable", { defaultValue: "图片暂不可用" })}
                  </div>
                )}
                {!disabled && (
                  <button
                    type="button"
                    className="memo-block-remove"
                    onClick={() => removeBlock(block)}
                    title={t("common.delete", { defaultValue: "删除" })}
                    aria-label={t("memo.deleteImage", { defaultValue: "删除图片" })}
                  >
                    ×
                  </button>
                )}
              </figure>
            );
          }

          if (block.type === "todo") {
            const detectedLink = block.link ?? findMemoTextLinks(block.text)[0]?.url;
            const styledLink = block.link ?? memoLinkFromPastedText(block.text);
            return (
              <div
                key={block.id}
                className={`memo-todo-row group ${detectedLink ? "has-link" : ""}`}
                style={{ fontSize: `${fontSize}px`, fontFamily }}
              >
                <button
                  type="button"
                  className={`memo-checkbox ${block.checked ? "is-checked" : ""}`}
                  onClick={() =>
                    updateBlock(block.id, (current) => ({
                      ...(current as MemoTodoBlock),
                      checked: !(current as MemoTodoBlock).checked,
                    }))
                  }
                  disabled={disabled}
                  aria-label={
                    block.checked
                      ? t("memo.markIncomplete", { defaultValue: "标记为未完成" })
                      : t("memo.markComplete", { defaultValue: "标记为完成" })
                  }
                >
                  {block.checked && (
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="m3.5 8.2 2.7 2.7 6.3-6.3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
                <textarea
                  ref={(element) => {
                    if (element) inputRefs.current.set(block.id, element);
                    else inputRefs.current.delete(block.id);
                  }}
                  value={block.text}
                  rows={1}
                  onFocus={() => {
                    activeBlockIdRef.current = block.id;
                  }}
                  onChange={(event) =>
                    updateBlock(block.id, (current) => ({
                      ...(current as MemoTodoBlock),
                      text: event.target.value,
                    }))
                  }
                  onPaste={(event) => handleTextPaste(event, block)}
                  onKeyDown={(event) => handleTodoKeyDown(event, block)}
                  placeholder={
                    index === 0
                      ? t("memo.todoPlaceholder", { defaultValue: "待办事项" })
                      : undefined
                  }
                  className={`memo-block-input memo-todo-input ${block.checked ? "is-checked" : ""} ${styledLink ? "is-linked" : ""}`}
                  title={detectedLink}
                  style={{
                    fontWeight: block.format?.bold ? 700 : undefined,
                    fontStyle: block.format?.italic ? "italic" : undefined,
                    textDecoration: [
                      block.checked ? "line-through" : "",
                      block.format?.underline || styledLink ? "underline" : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  }}
                  disabled={disabled}
                />
                {detectedLink && (
                  <button
                    type="button"
                    className="memo-row-link"
                    onClick={() => openStoredLink(detectedLink)}
                    title={t("memo.openLink", { defaultValue: "打开链接" })}
                    aria-label={t("memo.openLink", { defaultValue: "打开链接" })}
                  >
                    ↗
                  </button>
                )}
                {!disabled && (
                  <button
                    type="button"
                    className="memo-row-remove"
                    onClick={() => removeBlock(block)}
                    aria-label={t("memo.deleteTodo", { defaultValue: "删除待办" })}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          }

          const detectedLink = block.link ?? findMemoTextLinks(block.text)[0]?.url;
          const styledLink = block.link ?? memoLinkFromPastedText(block.text);
          return (
            <div key={block.id} className={`memo-text-row group ${detectedLink ? "has-link" : ""}`}>
              <textarea
                ref={(element) => {
                  if (element) inputRefs.current.set(block.id, element);
                  else inputRefs.current.delete(block.id);
                }}
                value={block.text}
                rows={block.style === "heading" ? 1 : 3}
                onFocus={() => {
                  activeBlockIdRef.current = block.id;
                }}
                onChange={(event) =>
                  updateBlock(block.id, (current) => ({
                    ...(current as MemoTextBlock),
                    text: event.target.value,
                  }))
                }
                onPaste={(event) => handleTextPaste(event, block)}
                placeholder={index === 0 ? placeholder : undefined}
                className={`memo-block-input memo-text-input ${
                  block.style === "heading" ? "is-heading" : ""
                } ${styledLink ? "is-linked" : ""}`}
                title={detectedLink}
                style={{
                  fontSize: `${block.style === "heading" ? fontSize + 2 : fontSize}px`,
                  fontFamily,
                  fontWeight: block.format?.bold ? 700 : undefined,
                  fontStyle: block.format?.italic ? "italic" : undefined,
                  textDecoration: block.format?.underline || styledLink ? "underline" : undefined,
                }}
                disabled={disabled}
                spellCheck={false}
              />
              {detectedLink && (
                <button
                  type="button"
                  className="memo-row-link"
                  onClick={() => openStoredLink(detectedLink)}
                  title={t("memo.openLink", { defaultValue: "打开链接" })}
                  aria-label={t("memo.openLink", { defaultValue: "打开链接" })}
                >
                  ↗
                </button>
              )}
              {!disabled && document.blocks.length > 1 && (
                <button
                  type="button"
                  className="memo-row-remove"
                  onClick={() => removeBlock(block)}
                  aria-label={t("memo.deleteText", { defaultValue: "删除文本块" })}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!disabled && showToolbar && (
        <div
          className="memo-editor-toolbar"
          aria-label={t("memo.toolbarLabel", { defaultValue: "便签快捷工具" })}
        >
          <button
            type="button"
            onClick={undo}
            className="memo-tool-button memo-tool-icon"
            title={t("notepad.toolbar.undo", { defaultValue: "撤销" })}
            aria-label={t("notepad.toolbar.undo", { defaultValue: "撤销" })}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M7.5 5 3.5 9l4 4M4 9h7.5a4.5 4.5 0 0 1 0 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={redo}
            className="memo-tool-button memo-tool-icon"
            title={t("notepad.toolbar.redo", { defaultValue: "重做" })}
            aria-label={t("notepad.toolbar.redo", { defaultValue: "重做" })}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="m12.5 5 4 4-4 4M16 9H8.5a4.5 4.5 0 0 0 0 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="memo-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => toggleActiveFormat("bold")}
            className="memo-tool-button memo-tool-icon"
            title={t("memo.bold", { defaultValue: "加粗" })}
            aria-label={t("memo.bold", { defaultValue: "加粗" })}
          >
            <span className="font-bold text-[14px]" aria-hidden="true">
              B
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleActiveFormat("italic")}
            className="memo-tool-button memo-tool-icon"
            title={t("memo.italic", { defaultValue: "斜体" })}
            aria-label={t("memo.italic", { defaultValue: "斜体" })}
          >
            <span className="italic text-[14px] font-serif" aria-hidden="true">
              I
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleActiveFormat("underline")}
            className="memo-tool-button memo-tool-icon"
            title={t("memo.underline", { defaultValue: "下划线" })}
            aria-label={t("memo.underline", { defaultValue: "下划线" })}
          >
            <span className="underline text-[14px]" aria-hidden="true">
              U
            </span>
          </button>
          <span className="memo-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={toggleActiveTodo}
            className="memo-tool-button memo-tool-icon"
            title={t("memo.toggleTodo", { defaultValue: "切换待办" })}
            aria-label={t("memo.toggleTodo", { defaultValue: "切换待办" })}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
              <rect
                x="3"
                y="3"
                width="5"
                height="5"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M10.5 5.5H17M10.5 13.5H17M3 13.5h5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="memo-tool-button memo-tool-icon"
            title={t("memo.addImage", { defaultValue: "图片" })}
            aria-label={t("memo.addImage", { defaultValue: "图片" })}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
              <rect
                x="2.5"
                y="3"
                width="15"
                height="14"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="7" cy="8" r="1.5" fill="currentColor" />
              <path
                d="m4.5 15 4-4 2.8 2.6 2.2-2.1 2 2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void processFiles(files);
            }}
          />
        </div>
      )}
    </div>
  );
});
