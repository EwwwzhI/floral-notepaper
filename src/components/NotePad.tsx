import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createNote, getErrorMessage, getNote, listNotes, updateNote } from "../features/notes/api";
import { saveImage } from "../features/images/api";
import {
  extractPendingImageIds,
  pendingImageObjectUrls,
  replacePendingImageRefs,
  revokePendingImages,
  type PendingImage,
} from "../features/images/pendingImages";
import { useImageBaseDir } from "../features/images/useImageBaseDir";
import { reportInstallPreparation } from "../features/update/api";
import type { UpdateInstallPrepareRequest } from "../features/update/types";
import { showToast } from "./Toast";
import type { Note, NoteMetadata } from "../features/notes/types";
import { countNoteChars, metadataFromNote } from "../features/notes/noteUtils";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  animateCurrentWindowBounds,
  closeCurrentWindow,
  getCurrentWindowBounds,
  recycleCurrentNotepad,
  setCurrentWindowAlwaysOnTop,
  showCurrentWindow,
  startCurrentWindowDrag,
  startCurrentWindowResize,
} from "../features/windows/controls";
import type { ResizeDirection } from "../features/windows/controls";
import { getConfig } from "../features/settings/api";
import { applyAppFont, resolveNoteFontFamily } from "../features/settings/fonts";
import {
  DEFAULT_TILE_COLOR,
  normalizeTileColor,
  resolveTileColor,
} from "../features/settings/tileColor";
import type { AppConfig, TileColorMode } from "../features/settings/types";
import { shouldSaveBeforeSwitchingToTile } from "../features/windows/noteSurfaceSavePolicy";
import {
  NOTE_SURFACE_ACTION_EVENT,
  surfaceActionFromEvent,
} from "../features/windows/surfaceActions";
import {
  NOTE_SURFACE_MODE_EVENT,
  getSurfaceTargetBounds,
  surfaceModeFromEvent,
} from "../features/windows/surfaceMode";
import type { NoteSurfaceMode } from "../features/windows/surfaceMode";
import {
  emitTileWindowUnpinned,
  tileSurfaceModeUnpinNoteId,
} from "../features/windows/tileWindowEvents";
import { NotepadOpenPanel } from "./NotepadOpenPanel";
import { Tile } from "./Tile";
import { ScratchMarkdownEditor, type ScratchMarkdownEditorHandle } from "./ScratchMarkdownEditor";
import type { FormatAction } from "../features/markdown/editorCommands";

type OpenMode = "new" | "open";
type PadDocumentKind = "scratch" | "existing";
type NotePadStatus = "empty" | "opened" | "saved" | "dirty" | "saveFailed" | "copied";

interface NotePadProps {
  initialNoteId?: string;
  initialSurfaceMode?: NoteSurfaceMode;
  initialAutoSave?: boolean;
  initialTileColor?: string;
}

const surfaceResizeHandles: Array<{
  direction: ResizeDirection;
  className: string;
  size: string;
}> = [
  {
    direction: "NorthWest",
    size: "w-8 h-8",
    className: "top-0 left-0 cursor-nwse-resize",
  },
  {
    direction: "NorthEast",
    size: "w-5 h-5",
    className: "top-0 right-0 cursor-nesw-resize",
  },
  {
    direction: "SouthWest",
    size: "w-8 h-8",
    className: "bottom-0 left-0 cursor-nesw-resize",
  },
  {
    direction: "SouthEast",
    size: "w-5 h-5",
    className: "bottom-0 right-0 cursor-nwse-resize",
  },
];

function SurfaceResizeHandles() {
  return (
    <>
      {surfaceResizeHandles.map((handle) => (
        <div
          key={handle.direction}
          aria-hidden="true"
          data-surface-resize-handle="true"
          data-resize-direction={handle.direction}
          onMouseDown={(event) => {
            event.stopPropagation();
            void startCurrentWindowResize(handle.direction).catch(() => undefined);
          }}
          className={`absolute ${handle.size} opacity-0 ${handle.className}`}
        />
      ))}
    </>
  );
}

export function NotePad({
  initialNoteId,
  initialSurfaceMode = "pad",
  initialAutoSave = true,
  initialTileColor = DEFAULT_TILE_COLOR,
}: NotePadProps) {
  const { t } = useTranslation();
  const [surfaceMode, setSurfaceMode] = useState<NoteSurfaceMode>(initialSurfaceMode);
  const [mode, setMode] = useState<OpenMode>("new");
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [documentKind, setDocumentKind] = useState<PadDocumentKind>(
    initialNoteId ? "existing" : "scratch",
  );
  const [, setScratchSourceNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<NotePadStatus>("empty");
  const [noteSurfaceAutoSave, setNoteSurfaceAutoSave] = useState(initialAutoSave);
  const [tileColorRaw, setTileColorRaw] = useState(normalizeTileColor(initialTileColor));
  const [tileColorMode, setTileColorMode] = useState<TileColorMode>("system");
  const [surfaceFontSize, setSurfaceFontSize] = useState(14);
  const [tileRenderMarkdown, setTileRenderMarkdown] = useState(false);
  const [noteFontFamily, setNoteFontFamily] = useState("var(--font-body)");
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage>>({});
  const pendingImagesRef = useRef<Record<string, PendingImage>>({});
  const [tileColor, setTileColor] = useState(() =>
    resolveTileColor("system", normalizeTileColor(initialTileColor)),
  );
  const [isExiting, setIsExiting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const scratchEditorRef = useRef<ScratchMarkdownEditorHandle | null>(null);
  const windowLabelRef = useRef("");
  const statusRef = useRef<NotePadStatus>("empty");
  const contentValueRef = useRef(content);
  contentValueRef.current = content;
  const titleValueRef = useRef(title);
  titleValueRef.current = title;
  const isStandby = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("standby") === "1",
  );
  const hasEnteredOnce = useRef(false);
  pendingImagesRef.current = pendingImages;
  const pendingImageUrls = useMemo(() => pendingImageObjectUrls(pendingImages), [pendingImages]);
  const statusLabel = useMemo<Record<NotePadStatus, string>>(
    () => ({
      empty: t("notepad.status.empty", { defaultValue: "空" }),
      opened: t("notepad.status.opened", { defaultValue: "已打开" }),
      saved: t("notepad.status.saved", { defaultValue: "已保存" }),
      dirty: t("notepad.status.unsaved", { defaultValue: "未保存" }),
      saveFailed: t("notepad.status.saveFailed", { defaultValue: "保存失败" }),
      copied: t("notepad.status.copied", { defaultValue: "已复制" }),
    }),
    [t],
  );
  const tabLabels = useMemo(
    () => ({
      new: t("notepad.tab.new", { defaultValue: "新建" }),
      edit: t("notepad.tab.edit", { defaultValue: "编辑" }),
      open: t("notepad.tab.open", { defaultValue: "打开" }),
    }),
    [t],
  );
  const formatButtons = useMemo<
    Array<{ label: string; title: string; action: FormatAction; style?: string }>
  >(
    () => [
      {
        label: "B",
        title: t("notepad.toolbar.bold", { defaultValue: "粗体" }),
        action: "bold",
        style: "font-bold",
      },
      {
        label: "I",
        title: t("notepad.toolbar.italic", { defaultValue: "斜体" }),
        action: "italic",
        style: "italic",
      },
      {
        label: "H1",
        title: t("notepad.toolbar.heading1", { defaultValue: "一级标题" }),
        action: "heading1",
        style: "font-mono text-[9px]",
      },
      {
        label: "H2",
        title: t("notepad.toolbar.heading2", { defaultValue: "二级标题" }),
        action: "heading2",
        style: "font-mono text-[9px]",
      },
      {
        label: "H3",
        title: t("notepad.toolbar.heading3", { defaultValue: "三级标题" }),
        action: "heading3",
        style: "font-mono text-[9px]",
      },
      {
        label: "1.",
        title: t("notepad.toolbar.ol", { defaultValue: "有序列表" }),
        action: "ol",
        style: "font-mono text-[9px]",
      },
      {
        label: "☐",
        title: t("notepad.toolbar.todo", { defaultValue: "待办" }),
        action: "todo",
        style: "text-[12px]",
      },
      {
        label: "☑",
        title: t("notepad.toolbar.todoToggle", { defaultValue: "切换完成" }),
        action: "todoToggle",
        style: "text-[12px]",
      },
    ],
    [t],
  );
  statusRef.current = status;

  const refreshNotes = useCallback(async () => {
    const loadedNotes = await listNotes();
    setNotes(loadedNotes);
    return loadedNotes;
  }, []);

  const applyNote = useCallback((note: Note, kind: PadDocumentKind = "existing") => {
    setEditingNoteId(kind === "existing" ? note.id : null);
    setScratchSourceNoteId(kind === "scratch" ? note.id : null);
    setDocumentKind(kind);
    setTitle(note.title);
    setContent(note.content);
    revokePendingImages(Object.values(pendingImagesRef.current));
    pendingImagesRef.current = {};
    setPendingImages({});
    setMode("new");
    setStatus("opened");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [loadedConfig] = await Promise.all([getConfig(), refreshNotes()]);
        if (!cancelled) {
          setNoteSurfaceAutoSave(loadedConfig.noteSurfaceAutoSave);
          setSurfaceFontSize(loadedConfig.surfaceFontSize ?? 14);
          setTileRenderMarkdown(loadedConfig.tileRenderMarkdown ?? false);
          setTileColorRaw(normalizeTileColor(loadedConfig.tileColor));
          setTileColorMode(loadedConfig.tileColorMode ?? "system");
          setTileColor(
            resolveTileColor(loadedConfig.tileColorMode ?? "system", loadedConfig.tileColor),
          );
          const fontFamily = resolveNoteFontFamily(loadedConfig.noteFontFamily);
          setNoteFontFamily(fontFamily);
          applyAppFont(loadedConfig.noteFontFamily);
        }
        if (initialNoteId) {
          const note = await getNote(initialNoteId);
          if (!cancelled) applyNote(note);
        }
      } catch (error) {
        if (!cancelled) showToast(getErrorMessage(error));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, initialNoteId, refreshNotes]);

  useEffect(() => {
    const unlisten = listen("notes-changed", () => {
      void refreshNotes().catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  useEffect(() => {
    if (isStandby.current) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          hasEnteredOnce.current = true;
          void showCurrentWindow()
            .then(() => scratchEditorRef.current?.focus())
            .catch(() => undefined);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<AppConfig>("config-changed", (event) => {
      const mode = event.payload.tileColorMode ?? tileColorMode;
      const raw = event.payload.tileColor ?? tileColorRaw;
      setTileColorMode(mode);
      setTileColorRaw(normalizeTileColor(raw));
      setTileColor(resolveTileColor(mode, raw));
      if (event.payload.surfaceFontSize != null) setSurfaceFontSize(event.payload.surfaceFontSize);
      if (event.payload.tileRenderMarkdown != null)
        setTileRenderMarkdown(event.payload.tileRenderMarkdown);
      const fontFamily = resolveNoteFontFamily(event.payload.noteFontFamily);
      setNoteFontFamily(fontFamily);
      applyAppFont(event.payload.noteFontFamily);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [tileColorMode, tileColorRaw]);

  useEffect(() => {
    if (tileColorMode !== "system") return;
    const observer = new MutationObserver(() => {
      setTileColor(resolveTileColor("system", tileColorRaw));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [tileColorMode, tileColorRaw]);

  useEffect(() => {
    let myLabel = "";
    try {
      myLabel = getCurrentWindow().label;
      windowLabelRef.current = myLabel;
    } catch {
      // not in Tauri environment (tests)
    }

    const unlisten = listen<string>("notepad:activate", (event) => {
      if (event.payload !== myLabel) return;

      isStandby.current = false;
      hasEnteredOnce.current = true;
      setEditingNoteId(null);
      setScratchSourceNoteId(null);
      setDocumentKind("scratch");
      setTitle("");
      setContent("");
      setMode("new");
      setStatus("empty");
      setIsExiting(false);
      setSurfaceMode("pad");
      void refreshNotes().catch(() => undefined);
      void showCurrentWindow()
        .then(() => scratchEditorRef.current?.focus())
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  const saveNote = useCallback(async () => {
    const existingCategory = notes.find((n) => n.id === editingNoteId)?.category ?? "";
    let note =
      editingNoteId && documentKind === "existing"
        ? await updateNote(editingNoteId, { title, content, category: existingCategory })
        : await createNote({ title, content, category: existingCategory });

    const pendingIds = extractPendingImageIds(note.content);
    if (pendingIds.length > 0) {
      const replacements: Record<string, string> = {};
      const savedImages: PendingImage[] = [];
      for (const id of pendingIds) {
        const image = pendingImagesRef.current[id];
        if (!image) continue;
        replacements[id] = await saveImage(note.id, image.data, image.extension);
        savedImages.push(image);
      }
      if (Object.keys(replacements).length > 0) {
        const persistedContent = replacePendingImageRefs(note.content, replacements);
        note = await updateNote(note.id, {
          title,
          content: persistedContent,
          category: existingCategory,
        });
        contentValueRef.current = persistedContent;
        setContent(persistedContent);
        setPendingImages((current) => {
          const next = { ...current };
          for (const image of savedImages) delete next[image.tempId];
          pendingImagesRef.current = next;
          return next;
        });
        revokePendingImages(savedImages);
      }
    }

    setEditingNoteId(note.id);
    setDocumentKind("existing");
    setScratchSourceNoteId(null);
    setNotes((current) => {
      const metadata = metadataFromNote(note);
      const exists = current.some((item) => item.id === note.id);
      const next = exists
        ? current.map((item) => (item.id === note.id ? metadata : item))
        : [metadata, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
    const contentChanged = contentValueRef.current !== content || titleValueRef.current !== title;
    setStatus(contentChanged ? "dirty" : "saved");
    return note;
  }, [content, documentKind, editingNoteId, title, notes]);

  useEffect(() => {
    const unlisten = listen<UpdateInstallPrepareRequest>("update://prepare-install", (event) => {
      const respond = async () => {
        const windowLabel = windowLabelRef.current || "notepad";
        if (statusRef.current !== "dirty" || documentKind === "scratch") {
          await reportInstallPreparation(event.payload.requestId, windowLabel, "ready");
          return;
        }

        try {
          await saveNote();
          await reportInstallPreparation(event.payload.requestId, windowLabel, "ready");
        } catch (error) {
          setStatus("saveFailed");
          showToast(getErrorMessage(error));
          await reportInstallPreparation(
            event.payload.requestId,
            windowLabel,
            "failed",
            getErrorMessage(error),
          );
        }
      };

      void respond().catch(async (error) => {
        await reportInstallPreparation(
          event.payload.requestId,
          windowLabelRef.current || "notepad",
          "failed",
          getErrorMessage(error),
        ).catch(() => undefined);
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [saveNote, documentKind]);

  const hasDraftContent = useCallback(
    () => Boolean(editingNoteId || title.trim() || content.trim()),
    [content, editingNoteId, title],
  );

  const imageBaseDir = useImageBaseDir();

  const addPendingImages = useCallback((images: PendingImage[]) => {
    if (images.length === 0) return;
    setPendingImages((current) => ({
      ...current,
      ...Object.fromEntries(images.map((image) => [image.tempId, image])),
    }));
  }, []);

  const tileNoteId = editingNoteId ?? initialNoteId ?? "";

  const switchSurfaceMode = useCallback(
    async (nextMode: NoteSurfaceMode) => {
      const unpinnedNoteId = tileSurfaceModeUnpinNoteId(surfaceMode, nextMode, tileNoteId);
      setSurfaceMode(nextMode);
      if (unpinnedNoteId) {
        void emitTileWindowUnpinned(unpinnedNoteId).catch(() => undefined);
      }

      try {
        if (nextMode === "tile") {
          await setCurrentWindowAlwaysOnTop(true);
        }

        const currentBounds = await getCurrentWindowBounds();
        await animateCurrentWindowBounds(getSurfaceTargetBounds(nextMode, currentBounds));
      } catch (error) {
        showToast(getErrorMessage(error));
      }
    },
    [surfaceMode, tileNoteId],
  );

  useEffect(() => {
    function handleSurfaceModeRequest(event: Event) {
      const nextMode = surfaceModeFromEvent(event);
      if (!nextMode) return;
      void switchSurfaceMode(nextMode);
    }

    window.addEventListener(NOTE_SURFACE_MODE_EVENT, handleSurfaceModeRequest);
    return () => {
      window.removeEventListener(NOTE_SURFACE_MODE_EVENT, handleSurfaceModeRequest);
    };
  }, [switchSurfaceMode]);

  useEffect(() => {
    if (surfaceMode !== "tile") return;
    void setCurrentWindowAlwaysOnTop(true).catch(() => undefined);
  }, [surfaceMode]);

  const handleSave = useCallback(async () => {
    try {
      await saveNote();
    } catch (error) {
      setStatus("saveFailed");
      showToast(getErrorMessage(error));
    }
  }, [saveNote]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  const handleOpenNote = async (noteId: string) => {
    try {
      const note = await getNote(noteId);
      applyNote(note, "scratch");
      await switchSurfaceMode("pad");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handlePin = async () => {
    try {
      if (shouldSaveBeforeSwitchingToTile(noteSurfaceAutoSave) && documentKind === "existing") {
        await saveNote();
      }
      await switchSurfaceMode("tile");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleClose = useCallback(() => {
    setIsExiting(true);
    const closeSurface = surfaceMode === "tile" ? closeCurrentWindow : recycleCurrentNotepad;
    void closeSurface().catch((error) => {
      setIsExiting(false);
      showToast(getErrorMessage(error));
    });
  }, [surfaceMode]);

  const copyTileContent = useCallback(async () => {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        throw new Error(t("notepad.error.copyUnsupported", { defaultValue: "当前环境不支持复制" }));
      }
      await clipboard.writeText(content);
      setStatus("copied");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  }, [content, t]);

  useEffect(() => {
    function handleSurfaceActionRequest(event: Event) {
      const action = surfaceActionFromEvent(event);
      if (!action) return;

      if (action === "copy") {
        void copyTileContent();
        return;
      }

      if (action === "save") {
        void handleSave();
        return;
      }

      if (action === "close") {
        void handleClose();
        return;
      }

      void switchSurfaceMode("pad");
    }

    window.addEventListener(NOTE_SURFACE_ACTION_EVENT, handleSurfaceActionRequest);
    return () => {
      window.removeEventListener(NOTE_SURFACE_ACTION_EVENT, handleSurfaceActionRequest);
    };
  }, [copyTileContent, handleClose, handleSave, switchSurfaceMode]);

  useEffect(() => {
    if (
      !noteSurfaceAutoSave ||
      mode !== "new" ||
      status !== "dirty" ||
      documentKind !== "existing"
    ) {
      return undefined;
    }
    if (!hasDraftContent()) return undefined;

    const timer = window.setTimeout(() => {
      void handleSave();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [handleSave, hasDraftContent, mode, noteSurfaceAutoSave, status, documentKind]);

  const handleDrag = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea")) return;
    void startCurrentWindowDrag().catch(() => undefined);
  };

  const resetDraft = () => {
    setEditingNoteId(null);
    setDocumentKind("scratch");
    setScratchSourceNoteId(null);
    setTitle("");
    setContent("");
    revokePendingImages(Object.values(pendingImagesRef.current));
    pendingImagesRef.current = {};
    setPendingImages({});
    setMode("new");
    setStatus("empty");
  };

  const isTile = surfaceMode === "tile";
  const tileTitle = title.trim();
  const enterClass = hasEnteredOnce.current ? "" : "animate-window-enter";
  const surfaceWrapperClassName = `w-full h-screen flex flex-col bg-transparent p-0 ${isExiting ? "animate-window-exit" : enterClass}`;
  const padSurfaceClassName =
    "app-surface-frame relative noise-bg w-full h-full min-h-0 bg-cloud overflow-hidden flex flex-col flex-1 border border-paper-deep/70 shadow-[0_1px_10px_rgba(26,26,24,0.06)] transition-all duration-200 ease-out";

  return (
    <div className={surfaceWrapperClassName}>
      {isTile ? (
        <Tile
          title={tileTitle || undefined}
          content={content}
          color={tileColor}
          fontSize={surfaceFontSize}
          renderMarkdown={tileRenderMarkdown}
          imageBaseDir={imageBaseDir ?? undefined}
          noteFontFamily={noteFontFamily}
          pendingImages={pendingImageUrls}
          width="100%"
          className="h-full cursor-default"
          data-surface-mode={surfaceMode}
          data-context-menu="tile"
          data-note-id={tileNoteId}
          onMouseDown={handleDrag}
        >
          <button
            type="button"
            aria-label="取消钉屏"
            title="取消钉屏"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void handleClose()}
            className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full text-ink-ghost/70 hover:text-red-400 hover:bg-danger-bg/80 transition-colors cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <SurfaceResizeHandles />
        </Tile>
      ) : (
        <div className={padSurfaceClassName} data-surface-mode={surfaceMode}>
          <>
            <div
              className="flex items-center justify-between px-4 pt-3 pb-0 cursor-default"
              onMouseDown={handleDrag}
            >
              <div className="flex items-center gap-0.5">
                <button
                  onClick={resetDraft}
                  className={`relative px-3.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${
                    mode === "new"
                      ? "text-bamboo font-medium"
                      : "text-ink-ghost hover:text-ink-faint"
                  }`}
                >
                  {editingNoteId ? tabLabels.edit : tabLabels.new}
                  {mode === "new" && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />
                  )}
                </button>
                <button
                  onClick={() => setMode("open")}
                  className={`relative px-3.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${
                    mode === "open"
                      ? "text-bamboo font-medium"
                      : "text-ink-ghost hover:text-ink-faint"
                  }`}
                >
                  {tabLabels.open}
                  {mode === "open" && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void handlePin()}
                  className="group w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
                  title={t("notepad.tooltip.pinToTile", { defaultValue: "转为磁贴" })}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                  </svg>
                </button>

                <button
                  onClick={() => void handleClose()}
                  className="group w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:bg-danger-bg hover:text-red-400 transition-all duration-200 cursor-pointer"
                  title={t("notepad.tooltip.close", { defaultValue: "关闭" })}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mx-4 mt-1 h-px bg-paper-deep/50" />

            {mode === "new" ? (
              <div
                data-pad-editor-body="true"
                className="px-4 pt-3 pb-2 flex flex-col flex-1 min-h-0"
              >
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setStatus("dirty");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "ArrowDown") {
                      event.preventDefault();
                      scratchEditorRef.current?.focus();
                    }
                  }}
                  placeholder={t("notepad.placeholder.title", { defaultValue: "标题（可选）" })}
                  className="w-full font-display font-medium text-ink placeholder:text-ink-ghost/60 mb-2 tracking-wide shrink-0"
                  style={{ fontSize: `${surfaceFontSize}px` }}
                />

                <div className="flex flex-wrap items-center gap-1 mb-2 shrink-0">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => scratchEditorRef.current?.undo()}
                    title={t("notepad.toolbar.undo", { defaultValue: "撤销" })}
                    className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                  >
                    ↶
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => scratchEditorRef.current?.redo()}
                    title={t("notepad.toolbar.redo", { defaultValue: "重做" })}
                    className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                  >
                    ↷
                  </button>
                  <span className="h-4 w-px bg-paper-deep/60 mx-0.5" />
                  {formatButtons.map((button) => (
                    <button
                      key={button.action}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => scratchEditorRef.current?.format(button.action)}
                      title={button.title}
                      className={`w-6 h-6 flex items-center justify-center rounded text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer ${button.style ?? ""}`}
                    >
                      {button.label}
                    </button>
                  ))}
                </div>

                <ScratchMarkdownEditor
                  ref={scratchEditorRef}
                  value={content}
                  onChange={setContent}
                  onDirty={() => setStatus("dirty")}
                  onAddPendingImages={addPendingImages}
                  onRemovePendingImage={(tempId) => {
                    const image = pendingImagesRef.current[tempId];
                    if (image) revokePendingImages([image]);
                    setPendingImages((current) => {
                      const next = { ...current };
                      delete next[tempId];
                      pendingImagesRef.current = next;
                      return next;
                    });
                  }}
                  pendingImages={pendingImageUrls}
                  imageBaseDir={imageBaseDir ?? undefined}
                  fontSize={surfaceFontSize}
                  fontFamily={noteFontFamily}
                  placeholder={t("notepad.placeholder.content", { defaultValue: "写点什么……" })}
                  t={t}
                />

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-paper-deep/30 shrink-0">
                  <span className="text-[11px] text-ink-ghost font-mono tabular-nums truncate max-w-[170px]">
                    {`${countNoteChars(content)} ${t("common.wordCountUnit", { defaultValue: "字" })} · ${statusLabel[status]}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={resetDraft}
                      className="px-4 py-1.5 text-[12px] text-ink-faint hover:text-ink-soft rounded-lg hover:bg-paper-warm transition-all duration-200 cursor-pointer"
                    >
                      {t("notepad.button.clear", { defaultValue: "清空" })}
                    </button>
                    <button
                      onClick={() => void handleSave()}
                      className="px-4 py-1.5 text-[12px] text-cloud bg-bamboo hover:bg-bamboo-light rounded-lg transition-all duration-200 font-medium cursor-pointer"
                    >
                      {t("common.save", { defaultValue: "保存" })}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <NotepadOpenPanel
                notes={notes}
                onOpenNote={(noteId) => void handleOpenNote(noteId)}
              />
            )}
          </>
          <SurfaceResizeHandles />
        </div>
      )}
    </div>
  );
}
