import { convertFileSrc } from "@tauri-apps/api/core";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { Extension, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem } from "@tiptap/extension-list/task-item";
import { TaskList } from "@tiptap/extension-list/task-list";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions/placeholder";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection as ProseMirrorSelection,
} from "@tiptap/pm/state";
import { writeHtml, writeImage } from "@tauri-apps/plugin-clipboard-manager";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { createPendingImageFromFile, type PendingImage } from "../features/images/pendingImages";
import {
  createMemoBlockId,
  parseMemoContent,
  serializeMemoDocument,
} from "../features/memo/document";
import { memoDocumentToTiptap, tiptapToMemoDocument } from "../features/memo/tiptapAdapter";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const IMAGE_MIME_RE = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/;

type ClipboardCommand = "copy" | "cut" | "paste" | "selectAll";
type MemoEditorElement = HTMLDivElement & {
  floralPasteImages?: (files: File[]) => void;
  floralClipboardCommand?: (
    command: ClipboardCommand,
    content?: string,
    isHtml?: boolean,
  ) => Promise<boolean>;
};

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
  alignImage: (alignment: "left" | "center" | "right") => void;
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

const MemoAttributes = Extension.create({
  name: "memoAttributes",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("memoBlockIds"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          let transaction = newState.tr;
          let changed = false;
          newState.doc.descendants((node, position) => {
            if (
              ["paragraph", "heading", "taskItem", "image"].includes(node.type.name) &&
              !node.attrs.blockId
            ) {
              transaction = transaction.setNodeMarkup(position, undefined, {
                ...node.attrs,
                blockId: createMemoBlockId(),
              });
              changed = true;
            }
          });
          return changed ? transaction.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "taskItem", "image"],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-memo-block-id"),
            renderHTML: (attributes) =>
              attributes.blockId ? { "data-memo-block-id": attributes.blockId } : {},
          },
        },
      },
      {
        types: ["image"],
        attributes: {
          storageSrc: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-storage-src"),
            renderHTML: () => ({}),
          },
          align: {
            default: "center",
            parseHTML: (element) => element.getAttribute("data-align") ?? "center",
            renderHTML: (attributes) => ({ "data-align": attributes.align ?? "center" }),
          },
        },
      },
    ];
  },
});

const ImageParagraph = Extension.create({
  name: "imageParagraph",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
          return false;
        }
        return this.editor
          .chain()
          .insertContentAt(selection.to, {
            type: "paragraph",
            attrs: { blockId: createMemoBlockId() },
          })
          .setTextSelection(selection.to + 1)
          .run();
      },
    };
  },
});

export function createMemoEditorExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      strike: false,
      heading: { levels: [2] },
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
      },
    }),
    TaskList.configure({ HTMLAttributes: { class: "memo-task-list" } }),
    TaskItem.configure({
      nested: false,
      HTMLAttributes: { class: "memo-task-item" },
    }),
    Image.configure({ inline: false, allowBase64: true, resize: false }),
    Placeholder.configure({ placeholder }),
    MemoAttributes,
    ImageParagraph,
  ];
}

export function clipboardPlainText(wrapper: HTMLElement): string {
  return Array.from(wrapper.children)
    .flatMap((element) => {
      if (element.matches('ul[data-type="taskList"]')) {
        return Array.from(element.querySelectorAll(':scope > li[data-type="taskItem"]'))
          .map((item) => {
            const body = item.querySelector(":scope > div")?.textContent ?? item.textContent ?? "";
            return body;
          })
          .join("\n");
      }
      if (element instanceof HTMLImageElement) return element.alt ? `[${element.alt}]` : "";
      return element.textContent ?? "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function sanitizeClipboardHtml(wrapper: HTMLElement): void {
  for (const taskList of Array.from(
    wrapper.querySelectorAll<HTMLElement>('ul[data-type="taskList"]'),
  )) {
    const fragment = document.createDocumentFragment();
    for (const item of Array.from(
      taskList.querySelectorAll<HTMLElement>(':scope > li[data-type="taskItem"]'),
    )) {
      const body = item.querySelector<HTMLElement>(":scope > div");
      if (body) {
        while (body.firstChild) fragment.appendChild(body.firstChild);
      } else if (item.textContent) {
        const paragraph = document.createElement("p");
        paragraph.textContent = item.textContent;
        fragment.appendChild(paragraph);
      }
    }
    taskList.replaceWith(fragment);
  }
  wrapper
    .querySelectorAll("[data-memo-block-id]")
    .forEach((element) => element.removeAttribute("data-memo-block-id"));
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

async function selectedClipboard(editor: Editor): Promise<{ html: string; text: string }> {
  const slice = editor.state.selection.content();
  const wrapper = document.createElement("div");
  wrapper.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
  const text = clipboardPlainText(wrapper);
  sanitizeClipboardHtml(wrapper);
  await Promise.all(
    Array.from(wrapper.querySelectorAll("img")).map(async (image) => {
      try {
        const response = await fetch(image.src);
        if (response.ok) image.src = await blobDataUrl(await response.blob());
      } catch {
        // Keep the original URL when an external image cannot be embedded.
      }
    }),
  );
  return { html: wrapper.innerHTML, text };
}

async function writeEditorClipboard(editor: Editor): Promise<boolean> {
  if (editor.state.selection.empty) return false;
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    const src = selection.node.attrs.src;
    if (typeof src !== "string" || !src) return false;
    try {
      const response = await fetch(src);
      if (response.ok) {
        const image = await TauriImage.fromBytes(await response.arrayBuffer());
        try {
          await writeImage(image);
          return true;
        } finally {
          await image.close();
        }
      }
    } catch {
      // Some formats (for example SVG) cannot become a native bitmap; use HTML below.
    }
  }
  const clipboard = await selectedClipboard(editor);
  await writeHtml(clipboard.html, clipboard.text);
  return true;
}

export const MemoEditor = forwardRef<MemoEditorHandle, MemoEditorProps>(function MemoEditor(
  {
    value,
    onChange,
    onDirty,
    onAddPendingImages,
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
  const rootRef = useRef<MemoEditorElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const suppressUpdateRef = useRef(false);
  const lastEmittedRef = useRef<string | null>(null);
  const savedSelectionRef = useRef<Record<string, unknown> | null>(null);
  const callbacksRef = useRef({ onChange, onDirty, onAddPendingImages, onError });
  callbacksRef.current = { onChange, onDirty, onAddPendingImages, onError };
  const imageContextRef = useRef({ imageBaseDir, pendingImages });
  imageContextRef.current = { imageBaseDir, pendingImages };

  const extensions = useMemo(() => createMemoEditorExtensions(placeholder), [placeholder]);
  const initialContentRef = useRef(
    memoDocumentToTiptap(parseMemoContent(value), (src) =>
      resolveImageSrc(src, imageBaseDir, pendingImages),
    ),
  );

  const emitContent = (instance: Editor) => {
    if (suppressUpdateRef.current || composingRef.current) return;
    const serialized = serializeMemoDocument(tiptapToMemoDocument(instance.getJSON()));
    if (serialized === lastEmittedRef.current) return;
    lastEmittedRef.current = serialized;
    callbacksRef.current.onChange(serialized);
    callbacksRef.current.onDirty();
  };

  const editor = useEditor({
    extensions,
    content: initialContentRef.current,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "memo-prosemirror",
        spellcheck: "false",
      },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          let selection = view.state.selection;
          if (event.target instanceof HTMLImageElement) {
            const position = view.posAtDOM(event.target, 0);
            selection = NodeSelection.create(view.state.doc, position);
            view.dispatch(view.state.tr.setSelection(selection));
          }
          savedSelectionRef.current = selection.toJSON();
          return false;
        },
      },
    },
    onUpdate: ({ editor: instance }) => emitContent(instance),
  });
  const selectedImageAlignment = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      const selection = instance.state.selection;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image")
        return null;
      return selection.node.attrs.align === "left" || selection.node.attrs.align === "right"
        ? selection.node.attrs.align
        : "center";
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || lastEmittedRef.current === value) return;
    const current = serializeMemoDocument(tiptapToMemoDocument(editor.getJSON()));
    if (current === value) return;
    suppressUpdateRef.current = true;
    const context = imageContextRef.current;
    const nextContent = memoDocumentToTiptap(parseMemoContent(value), (src) =>
      resolveImageSrc(src, context.imageBaseDir, context.pendingImages),
    );
    const nextDocument = editor.schema.nodeFromJSON(nextContent);
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, nextDocument.content)
        .setMeta("addToHistory", false)
        .setMeta("preventUpdate", true),
    );
    suppressUpdateRef.current = false;
    lastEmittedRef.current = value;
  }, [editor, imageBaseDir, pendingImages, value]);

  const insertImages = (images: PendingImage[]) => {
    if (!editor || images.length === 0 || disabled) return;
    callbacksRef.current.onAddPendingImages(images);
    const nodes: JSONContent[] = images.map((image) => ({
      type: "image",
      attrs: {
        src: image.objectUrl,
        storageSrc: `pending-image://${image.tempId}`,
        alt: image.fileName,
        blockId: createMemoBlockId(),
        align: "center",
      },
    }));
    nodes.push({ type: "paragraph", attrs: { blockId: createMemoBlockId() } });
    editor.chain().focus().insertContent(nodes).run();
  };

  const processFiles = async (files: File[]) => {
    try {
      const images: PendingImage[] = [];
      for (const file of files) {
        if (!IMAGE_MIME_RE.test(file.type)) continue;
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
      callbacksRef.current.onError?.(
        error instanceof Error
          ? error.message
          : t("errors.imagePasteFailed", { defaultValue: "图片导入失败" }),
      );
    }
  };
  const processFilesRef = useRef(processFiles);
  processFilesRef.current = processFiles;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !editor) return;
    root.floralPasteImages = (files) => {
      if (!disabled && files.length > 0) void processFilesRef.current(files);
    };
    root.floralClipboardCommand = async (command, content, isHtml = false) => {
      const saved = savedSelectionRef.current;
      if (saved) {
        editor.view.dispatch(
          editor.state.tr.setSelection(ProseMirrorSelection.fromJSON(editor.state.doc, saved)),
        );
      }
      if (command === "selectAll") return editor.chain().focus().selectAll().run();
      if (command === "paste") {
        if (!content) return false;
        return editor
          .chain()
          .focus()
          .insertContent(isHtml ? content : { type: "text", text: content })
          .run();
      }
      if (editor.state.selection.empty) return false;
      await writeEditorClipboard(editor);
      if (command === "cut") editor.chain().focus().deleteSelection().run();
      return true;
    };
    return () => {
      delete root.floralPasteImages;
      delete root.floralClipboardCommand;
    };
  }, [disabled, editor]);

  useImperativeHandle(
    ref,
    () => ({
      undo: () => editor?.chain().focus().undo().run(),
      redo: () => editor?.chain().focus().redo().run(),
      focus: () => editor?.chain().focus().run(),
      toggleBold: () => editor?.chain().focus().toggleBold().run(),
      toggleItalic: () => editor?.chain().focus().toggleItalic().run(),
      toggleUnderline: () => editor?.chain().focus().toggleUnderline().run(),
      toggleTodo: () => editor?.chain().focus().toggleTaskList().run(),
      alignImage: (alignment) =>
        editor?.chain().focus().updateAttributes("image", { align: alignment }).run(),
      openImagePicker: () => fileInputRef.current?.click(),
      insertImages,
    }),
    [editor],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = dataTransferImageFiles(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    if (editor) {
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (typeof position === "number") editor.commands.setTextSelection(position);
    }
    void processFiles(files);
  };

  const editorStyle = {
    "--memo-editor-font-size": `${fontSize}px`,
    "--memo-editor-font-family": fontFamily,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`memo-editor ${compact ? "memo-editor-compact" : ""}`}
      data-memo-editor="true"
      style={editorStyle}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        if (editor) emitContent(editor);
      }}
      onCopy={(event) => {
        if (!editor || editor.state.selection.empty) return;
        event.preventDefault();
        void writeEditorClipboard(editor).catch((error) => {
          callbacksRef.current.onError?.(error instanceof Error ? error.message : "复制失败");
        });
      }}
      onCut={(event) => {
        if (!editor || disabled || editor.state.selection.empty) return;
        event.preventDefault();
        void writeEditorClipboard(editor)
          .then((copied) => {
            if (copied) editor.chain().focus().deleteSelection().run();
          })
          .catch((error) => {
            callbacksRef.current.onError?.(error instanceof Error ? error.message : "剪切失败");
          });
      }}
      onPaste={(event) => {
        if (disabled) return;
        const files = dataTransferImageFiles(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        void processFiles(files);
      }}
      onDrop={handleDrop}
      onDragOver={(event) => {
        if (dataTransferImageFiles(event.dataTransfer).length === 0) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
    >
      <div className="memo-editor-canvas">
        <EditorContent editor={editor} />
      </div>

      {!disabled && showToolbar && (
        <div
          className="memo-editor-toolbar"
          aria-label={t("memo.toolbarLabel", { defaultValue: "便签快捷工具" })}
        >
          <button
            type="button"
            onClick={() => editor?.chain().focus().undo().run()}
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
            onClick={() => editor?.chain().focus().redo().run()}
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
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`memo-tool-button memo-tool-icon ${editor?.isActive("bold") ? "is-active" : ""}`}
            title={t("memo.bold", { defaultValue: "加粗" })}
            aria-label={t("memo.bold", { defaultValue: "加粗" })}
          >
            <span className="font-bold text-[14px]" aria-hidden="true">
              B
            </span>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`memo-tool-button memo-tool-icon ${editor?.isActive("italic") ? "is-active" : ""}`}
            title={t("memo.italic", { defaultValue: "斜体" })}
            aria-label={t("memo.italic", { defaultValue: "斜体" })}
          >
            <span className="italic text-[14px] font-serif" aria-hidden="true">
              I
            </span>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={`memo-tool-button memo-tool-icon ${editor?.isActive("underline") ? "is-active" : ""}`}
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
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            className={`memo-tool-button memo-tool-icon ${editor?.isActive("taskList") ? "is-active" : ""}`}
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
          {selectedImageAlignment && (
            <>
              <span className="memo-toolbar-divider" aria-hidden="true" />
              {(["left", "center", "right"] as const).map((alignment) => (
                <button
                  key={alignment}
                  type="button"
                  onClick={() =>
                    editor?.chain().focus().updateAttributes("image", { align: alignment }).run()
                  }
                  className={`memo-tool-button memo-tool-icon ${
                    selectedImageAlignment === alignment ? "is-active" : ""
                  }`}
                  title={
                    alignment === "left"
                      ? "图片左对齐"
                      : alignment === "right"
                        ? "图片右对齐"
                        : "图片居中"
                  }
                  aria-label={
                    alignment === "left"
                      ? "图片左对齐"
                      : alignment === "right"
                        ? "图片右对齐"
                        : "图片居中"
                  }
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d={
                        alignment === "left"
                          ? "M3 4h9M3 8h14M3 12h9M3 16h14"
                          : alignment === "right"
                            ? "M8 4h9M3 8h14M8 12h9M3 16h14"
                            : "M5.5 4h9M3 8h14M5.5 12h9M3 16h14"
                      }
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ))}
            </>
          )}
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
