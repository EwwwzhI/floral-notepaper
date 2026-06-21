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
import { showToast } from "./Toast";
import type { Note, NoteMetadata, NotesChangedEvent } from "../features/notes/types";
import { shouldReloadOpenNote } from "../features/notes/sync";
import { countNoteChars, metadataFromNote } from "../features/notes/noteUtils";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
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
import {
  NOTE_SURFACE_MODE_EVENT,
  getAutoSizedTileBounds,
  getSurfaceTargetBounds,
  surfaceModeFromEvent,
} from "../features/windows/surfaceMode";
import type { NoteSurfaceMode } from "../features/windows/surfaceMode";
import {
  emitTileWindowUnpinned,
  tileSurfaceModeUnpinNoteId,
} from "../features/windows/tileWindowEvents";
import {
  createEmptyMemoContent,
  memoHasContent,
  parseMemoContent,
  serializeMemoDocument,
} from "../features/memo/document";
import { MemoEditor, type MemoEditorHandle } from "./MemoEditor";
import { NotepadOpenPanel } from "./NotepadOpenPanel";
import { Tile } from "./Tile";

type OpenMode = "new" | "open";
type PadDocumentKind = "scratch" | "existing";
type NotePadStatus = "empty" | "opened" | "saving" | "saved" | "dirty" | "saveFailed";

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

function AlwaysOnTopIcon({ active, size = 16 }: { active: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.7 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4.5h16" />
      <path d="M12 19.5V8" />
      <path d="m6.5 13.5 5.5-5.5 5.5 5.5" />
    </svg>
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
  const [content, setContent] = useState(() => createEmptyMemoContent());
  const [status, setStatus] = useState<NotePadStatus>("empty");
  const [noteSurfaceAutoSave] = useState(initialAutoSave);
  const [tileColorRaw, setTileColorRaw] = useState(normalizeTileColor(initialTileColor));
  const [tileColorMode, setTileColorMode] = useState<TileColorMode>("system");
  const [surfaceFontSize, setSurfaceFontSize] = useState(14);
  const [noteFontFamily, setNoteFontFamily] = useState("var(--font-body)");
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage>>({});
  const pendingImagesRef = useRef<Record<string, PendingImage>>({});
  const [tileColor, setTileColor] = useState(() =>
    resolveTileColor("system", normalizeTileColor(initialTileColor)),
  );
  const [surfaceAlwaysOnTop, setSurfaceAlwaysOnTop] = useState(initialSurfaceMode === "tile");
  const [isExiting, setIsExiting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const memoEditorRef = useRef<MemoEditorHandle | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const shouldAutoSizeTileRef = useRef(initialSurfaceMode === "tile");
  const contentValueRef = useRef(content);
  contentValueRef.current = content;
  const titleValueRef = useRef(title);
  titleValueRef.current = title;
  const statusRef = useRef(status);
  statusRef.current = status;
  const editingNoteIdRef = useRef(editingNoteId);
  editingNoteIdRef.current = editingNoteId;
  const loadedUpdatedAtRef = useRef<string | null>(null);
  const currentWindowLabel = useMemo(() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return "notepad";
    }
  }, []);
  const isStandby = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("standby") === "1",
  );
  const hasEnteredOnce = useRef(false);
  const hasEnteredTile = useRef(initialSurfaceMode === "tile");
  pendingImagesRef.current = pendingImages;
  const pendingImageUrls = useMemo(() => pendingImageObjectUrls(pendingImages), [pendingImages]);
  const statusLabel = useMemo<Record<NotePadStatus, string>>(
    () => ({
      empty: t("notepad.status.empty", { defaultValue: "空" }),
      opened: t("notepad.status.opened", { defaultValue: "已打开" }),
      saving: t("notepad.status.saving", { defaultValue: "保存中" }),
      saved: t("notepad.status.saved", { defaultValue: "已保存" }),
      dirty: t("notepad.status.unsaved", { defaultValue: "未保存" }),
      saveFailed: t("notepad.status.saveFailed", { defaultValue: "保存失败" }),
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
  const refreshNotes = useCallback(async () => {
    const loadedNotes = await listNotes();
    setNotes(loadedNotes);
    return loadedNotes;
  }, []);

  const applyNote = useCallback((note: Note, kind: PadDocumentKind = "existing") => {
    const nextEditingNoteId = kind === "existing" ? note.id : null;
    const memoContent = serializeMemoDocument(parseMemoContent(note.content));
    editingNoteIdRef.current = nextEditingNoteId;
    loadedUpdatedAtRef.current = kind === "existing" ? note.updatedAt : null;
    titleValueRef.current = note.title;
    contentValueRef.current = memoContent;
    setEditingNoteId(nextEditingNoteId);
    setScratchSourceNoteId(kind === "scratch" ? note.id : null);
    setDocumentKind(kind);
    setTitle(note.title);
    setContent(memoContent);
    revokePendingImages(Object.values(pendingImagesRef.current));
    pendingImagesRef.current = {};
    setPendingImages({});
    setMode("new");
    statusRef.current = "opened";
    setStatus("opened");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [loadedConfig] = await Promise.all([getConfig(), refreshNotes()]);
        if (!cancelled) {
          setSurfaceFontSize(loadedConfig.surfaceFontSize ?? 14);
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
    const unlisten = listen<NotesChangedEvent | null>("notes-changed", (event) => {
      void refreshNotes().catch(() => undefined);
      const currentNoteId = editingNoteIdRef.current;
      const hasLocalChanges =
        statusRef.current === "dirty" ||
        statusRef.current === "saving" ||
        statusRef.current === "saveFailed";
      if (
        !shouldReloadOpenNote(event.payload, currentNoteId, currentWindowLabel, hasLocalChanges)
      ) {
        return;
      }

      void getNote(currentNoteId as string)
        .then((note) => {
          if (editingNoteIdRef.current !== note.id) return;
          if (
            statusRef.current === "dirty" ||
            statusRef.current === "saving" ||
            statusRef.current === "saveFailed"
          ) {
            return;
          }
          applyNote(note);
        })
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [applyNote, currentWindowLabel, refreshNotes]);

  useEffect(() => {
    if (isStandby.current) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          hasEnteredOnce.current = true;
          void showCurrentWindow()
            .then(() => memoEditorRef.current?.focus())
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
    } catch {
      // not in Tauri environment (tests)
    }

    const unlisten = listen<string>("notepad:activate", (event) => {
      if (event.payload !== myLabel) return;

      isStandby.current = false;
      hasEnteredOnce.current = true;
      editingNoteIdRef.current = null;
      loadedUpdatedAtRef.current = null;
      statusRef.current = "empty";
      setEditingNoteId(null);
      setScratchSourceNoteId(null);
      setDocumentKind("scratch");
      setTitle("");
      setContent(createEmptyMemoContent());
      revokePendingImages(Object.values(pendingImagesRef.current));
      pendingImagesRef.current = {};
      setPendingImages({});
      setMode("new");
      setStatus("empty");
      setIsExiting(false);
      setSurfaceMode("pad");
      setSurfaceAlwaysOnTop(false);
      hasEnteredTile.current = false;
      void setCurrentWindowAlwaysOnTop(false).catch(() => undefined);
      void refreshNotes().catch(() => undefined);
      void showCurrentWindow()
        .then(() => memoEditorRef.current?.focus())
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  const saveNote = useCallback(async () => {
    const titleSnapshot = title;
    const contentSnapshot = content;
    const expectedUpdatedAt = loadedUpdatedAtRef.current;
    const existingCategory = notes.find((n) => n.id === editingNoteId)?.category ?? "";
    statusRef.current = "saving";
    setStatus("saving");
    let note =
      editingNoteId && documentKind === "existing"
        ? await updateNote(
            editingNoteId,
            {
              title: titleSnapshot,
              content: contentSnapshot,
              category: existingCategory,
            },
            expectedUpdatedAt,
          )
        : await createNote({
            title: titleSnapshot,
            content: contentSnapshot,
            category: existingCategory,
          });
    let savedContent = contentSnapshot;

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
        savedContent = persistedContent;
        note = await updateNote(
          note.id,
          {
            title: titleSnapshot,
            content: persistedContent,
            category: existingCategory,
          },
          note.updatedAt,
        );
        const currentContent = replacePendingImageRefs(contentValueRef.current, replacements);
        contentValueRef.current = currentContent;
        setContent(currentContent);
        setPendingImages((current) => {
          const next = { ...current };
          for (const image of savedImages) delete next[image.tempId];
          pendingImagesRef.current = next;
          return next;
        });
        revokePendingImages(savedImages);
      }
    }

    editingNoteIdRef.current = note.id;
    loadedUpdatedAtRef.current = note.updatedAt;
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
    const contentChanged =
      contentValueRef.current !== savedContent || titleValueRef.current !== titleSnapshot;
    const nextStatus = contentChanged ? "dirty" : "saved";
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    return note;
  }, [content, documentKind, editingNoteId, title, notes]);

  const hasDraftContent = useCallback(
    () => Boolean(editingNoteId || title.trim() || memoHasContent(content)),
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
      if (nextMode === "tile" && surfaceMode !== "tile") {
        shouldAutoSizeTileRef.current = true;
      }
      setSurfaceMode(nextMode);
      if (unpinnedNoteId) {
        void emitTileWindowUnpinned(unpinnedNoteId).catch(() => undefined);
      }

      try {
        const currentBounds = await getCurrentWindowBounds();
        await animateCurrentWindowBounds(getSurfaceTargetBounds(nextMode, currentBounds));
      } catch (error) {
        showToast(getErrorMessage(error));
      }
    },
    [surfaceMode, tileNoteId],
  );

  useEffect(() => {
    if (
      surfaceMode !== "tile" ||
      !shouldAutoSizeTileRef.current ||
      (initialNoteId && !editingNoteId)
    ) {
      return undefined;
    }

    shouldAutoSizeTileRef.current = false;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const tile = tileRef.current;
        const contentElement = tile?.querySelector<HTMLElement>('[data-tile-content="true"]');
        const lastContent = contentElement?.lastElementChild;
        if (!tile || !contentElement || !(lastContent instanceof HTMLElement)) return;

        const tileTop = tile.getBoundingClientRect().top;
        const contentBottom = lastContent.getBoundingClientRect().bottom;
        const halfLine = surfaceFontSize * 0.85;
        const contentHeight = Math.ceil(contentBottom - tileTop + halfLine + 1);
        const appWindow = getCurrentWindow();

        void Promise.all([getCurrentWindowBounds(), appWindow.scaleFactor(), currentMonitor()])
          .then(([currentBounds, scaleFactor, monitor]) => {
            if (cancelled) return;
            const workArea = monitor
              ? {
                  x: monitor.workArea.position.x,
                  y: monitor.workArea.position.y,
                  width: monitor.workArea.size.width,
                  height: monitor.workArea.size.height,
                }
              : undefined;
            return animateCurrentWindowBounds(
              getAutoSizedTileBounds(currentBounds, contentHeight, scaleFactor, workArea),
            );
          })
          .catch((error) => {
            if (!cancelled) showToast(getErrorMessage(error));
          });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [editingNoteId, initialNoteId, surfaceFontSize, surfaceMode]);

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

  const toggleSurfaceAlwaysOnTop = useCallback(async () => {
    const nextValue = !surfaceAlwaysOnTop;
    try {
      await setCurrentWindowAlwaysOnTop(nextValue);
      setSurfaceAlwaysOnTop(nextValue);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  }, [surfaceAlwaysOnTop]);

  const handleSave = useCallback(async () => {
    try {
      await saveNote();
    } catch (error) {
      statusRef.current = "saveFailed";
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
      applyNote(note, "existing");
      await switchSurfaceMode("pad");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handlePin = async () => {
    try {
      if (hasDraftContent() && (documentKind === "scratch" || noteSurfaceAutoSave)) {
        await saveNote();
      }
      if (!hasEnteredTile.current) {
        await setCurrentWindowAlwaysOnTop(true);
        setSurfaceAlwaysOnTop(true);
        hasEnteredTile.current = true;
      }
      await switchSurfaceMode("tile");
    } catch (error) {
      statusRef.current = "saveFailed";
      setStatus("saveFailed");
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
    if (target.closest("button,input,textarea,a")) return;
    void startCurrentWindowDrag().catch(() => undefined);
  };

  const resetDraft = () => {
    editingNoteIdRef.current = null;
    loadedUpdatedAtRef.current = null;
    setEditingNoteId(null);
    setDocumentKind("scratch");
    setScratchSourceNoteId(null);
    setTitle("");
    setContent(createEmptyMemoContent());
    revokePendingImages(Object.values(pendingImagesRef.current));
    pendingImagesRef.current = {};
    setPendingImages({});
    setMode("new");
    statusRef.current = "empty";
    setStatus("empty");
  };

  const markDirty = useCallback(() => {
    statusRef.current = "dirty";
    setStatus("dirty");
  }, []);

  const isTile = surfaceMode === "tile";
  const tileTitle = title.trim();
  const enterClass = hasEnteredOnce.current ? "" : "animate-window-enter";
  const surfaceWrapperClassName = `w-full h-screen flex flex-col bg-transparent p-0 ${isExiting ? "animate-window-exit" : enterClass}`;
  const padSurfaceClassName =
    "app-surface-frame relative noise-bg w-full h-full min-h-0 bg-cloud overflow-hidden flex flex-col flex-1 border border-paper-deep/70 shadow-[0_1px_10px_var(--color-shadow)] transition-all duration-200 ease-out";

  return (
    <div className={surfaceWrapperClassName}>
      {isTile ? (
        <Tile
          tileRef={tileRef}
          title={tileTitle || undefined}
          content={content}
          color={tileColor}
          fontSize={surfaceFontSize}
          imageBaseDir={imageBaseDir ?? undefined}
          noteFontFamily={noteFontFamily}
          pendingImages={pendingImageUrls}
          onContentChange={(nextContent) => {
            setContent(nextContent);
            markDirty();
          }}
          width="100%"
          className="h-full cursor-default"
          data-surface-mode={surfaceMode}
          data-note-id={tileNoteId}
          onMouseDown={handleDrag}
        >
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <button
              type="button"
              aria-pressed={surfaceAlwaysOnTop}
              aria-label={
                surfaceAlwaysOnTop
                  ? t("notepad.tooltip.disableAlwaysOnTop", { defaultValue: "取消置顶" })
                  : t("notepad.tooltip.enableAlwaysOnTop", { defaultValue: "置顶窗口" })
              }
              title={
                surfaceAlwaysOnTop
                  ? t("notepad.tooltip.disableAlwaysOnTop", { defaultValue: "取消置顶" })
                  : t("notepad.tooltip.enableAlwaysOnTop", { defaultValue: "置顶窗口" })
              }
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void toggleSurfaceAlwaysOnTop()}
              className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors cursor-pointer ${
                surfaceAlwaysOnTop
                  ? "text-bamboo bg-bamboo-mist/80 hover:bg-bamboo-mist"
                  : "text-ink-ghost/70 hover:text-bamboo hover:bg-bamboo-mist/80"
              }`}
            >
              <AlwaysOnTopIcon active={surfaceAlwaysOnTop} size={15} />
            </button>
            <button
              type="button"
              aria-label={t("notepad.tooltip.edit", { defaultValue: "编辑便签" })}
              title={t("notepad.tooltip.edit", { defaultValue: "编辑便签" })}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void switchSurfaceMode("pad")}
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink-ghost/70 hover:text-bamboo hover:bg-bamboo-mist/80 transition-colors cursor-pointer"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={t("notepad.tooltip.unpin", { defaultValue: "取消钉屏" })}
              title={t("notepad.tooltip.unpin", { defaultValue: "取消钉屏" })}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void handleClose()}
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink-ghost/70 hover:text-red-400 hover:bg-danger-bg/80 transition-colors cursor-pointer"
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
          </div>
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
                  type="button"
                  aria-pressed={surfaceAlwaysOnTop}
                  aria-label={
                    surfaceAlwaysOnTop
                      ? t("notepad.tooltip.disableAlwaysOnTop", { defaultValue: "取消置顶" })
                      : t("notepad.tooltip.enableAlwaysOnTop", { defaultValue: "置顶窗口" })
                  }
                  title={
                    surfaceAlwaysOnTop
                      ? t("notepad.tooltip.disableAlwaysOnTop", { defaultValue: "取消置顶" })
                      : t("notepad.tooltip.enableAlwaysOnTop", { defaultValue: "置顶窗口" })
                  }
                  onClick={() => void toggleSurfaceAlwaysOnTop()}
                  className={`group w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer ${
                    surfaceAlwaysOnTop
                      ? "text-bamboo bg-bamboo-mist/70 hover:bg-bamboo-mist"
                      : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
                  }`}
                >
                  <AlwaysOnTopIcon active={surfaceAlwaysOnTop} />
                </button>
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
                    markDirty();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "ArrowDown") {
                      event.preventDefault();
                      memoEditorRef.current?.focus();
                    }
                  }}
                  placeholder={t("notepad.placeholder.title", { defaultValue: "标题（可选）" })}
                  className="w-full font-display font-semibold text-bamboo placeholder:text-ink-ghost/60 mb-1.5 tracking-wide shrink-0"
                  style={{ fontSize: `${surfaceFontSize}px` }}
                />

                <MemoEditor
                  ref={memoEditorRef}
                  value={content}
                  onChange={setContent}
                  onDirty={markDirty}
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
                  placeholder={t("notepad.placeholder.content", {
                    defaultValue: "随手记下文字，或在底部添加待办和图片……",
                  })}
                  compact
                  onError={showToast}
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
