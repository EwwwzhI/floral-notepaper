import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AboutPanel } from "./AboutPanel";
import { showToast } from "./Toast";
import {
  chooseDataDirectory,
  chooseNoteImage,
  getConfig,
  migrateDataDir,
  saveConfig,
} from "../features/settings/api";
import type { AppConfig } from "../features/settings/types";
import { normalizeTileColor } from "../features/settings/tileColor";
import { BackgroundLayer } from "./BackgroundLayer";
import { MemoEditor, type MemoEditorHandle } from "./MemoEditor";
import { SettingsPanel } from "./SettingsPanel";
import {
  createNote,
  createCategory,
  deleteCategory,
  deleteNote,
  chooseMarkdownExportPath,
  exportNoteMarkdown,
  getErrorMessage,
  getNote,
  listCategories,
  listNotes,
  moveNoteCategory,
  renameCategory,
  updateNote,
} from "../features/notes/api";
import { cleanUnusedImages, readExternalImage, saveImage } from "../features/images/api";
import {
  createPendingImage,
  extractPendingImageIds,
  pendingImageObjectUrls,
  replacePendingImageRefs,
  revokePendingImages,
  type PendingImage,
} from "../features/images/pendingImages";
import { applyAppFont, resolveNoteFontFamily } from "../features/settings/fonts";
import { useImageBaseDir } from "../features/images/useImageBaseDir";
import type { Note, NoteMetadata, NotesChangedEvent } from "../features/notes/types";
import { shouldReloadOpenNote } from "../features/notes/sync";
import {
  countNoteChars,
  filterNotes,
  formatShortDate,
  formatTime,
  getDisplayTitle,
  groupNotesByCategory,
  metadataFromNote,
} from "../features/notes/noteUtils";
import {
  appendMemoBlocks,
  createEmptyMemoContent,
  createMemoBlockId,
  memoBlockCount,
  memoHasContent,
  parseMemoContent,
  serializeMemoDocument,
  type MemoImageBlock,
} from "../features/memo/document";
import type { CategoryGroup } from "../features/notes/noteUtils";
import {
  getNoteContextMenuItems,
  type NoteContextMenuAction,
} from "../features/notes/noteContextMenu";
import { openNotepadWindow, toggleTileWindow } from "../features/windows/api";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  toggleMaximizeCurrentWindow,
  isCurrentWindowMaximized,
  startCurrentWindowDrag,
} from "../features/windows/controls";
import {
  TILE_WINDOW_CLOSED_EVENT,
  TILE_WINDOW_UNPINNED_EVENT,
  syncPinnedTileIds,
} from "../features/windows/tileWindowEvents";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type SidePanelMode = "about" | "settings";

interface NoteMenuState {
  x: number;
  y: number;
  noteId: string;
}

interface CategoryMenuState {
  x: number;
  y: number;
  category: string;
}

export function pinTileButtonTitle(isPinned: boolean): string {
  return isPinned ? "取消钉屏" : "钉到屏幕";
}

interface LoadEpoch {
  // 开始一次新的异步加载，返回本次 epoch token；之后用 isCurrent 校验是否仍然有效
  bump: () => number;
  // 只读取当前 epoch 而不自增：用于"记录事件到达瞬间的代次，期间若发生切换则过期"
  peek: () => number;
  // 异步完成后调用：仅当期间未发生新的 bump（用户未切换/重载）时为 true
  isCurrent: (token: number) => boolean;
}

// 统一封装"加载竞态守卫"：每次切换/加载笔记自增 epoch，异步结果回来后用
// isCurrent 判断是否过期。集中此处后，新增异步加载路径只需 bump/isCurrent 两步，
// 避免裸 ref 在多处内联导致的"忘记连线 → stale 结果覆盖新选中"竞态回归
function useLoadEpoch(): LoadEpoch {
  const ref = useRef(0);
  return useMemo<LoadEpoch>(
    () => ({
      bump: () => (ref.current += 1),
      peek: () => ref.current,
      isCurrent: (token: number) => ref.current === token,
    }),
    [],
  );
}

interface MainWindowProps {
  initialSettingsOpen?: boolean;
  initialConfig?: AppConfig;
}

export function MainWindow({
  initialSettingsOpen = false,
  initialConfig = undefined,
}: MainWindowProps = {}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null);
  const [noteMenuClosing, setNoteMenuClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mountedSidePanel, setMountedSidePanel] = useState<SidePanelMode | null>(
    initialSettingsOpen && initialConfig ? "settings" : null,
  );
  const [sidePanelContentVisible, setSidePanelContentVisible] = useState(
    Boolean(initialSettingsOpen && initialConfig),
  );
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(initialConfig ?? null);
  const [savedDataDir, setSavedDataDir] = useState<string | null>(initialConfig?.dataDir ?? null);
  const [noteTransitionKey, setNoteTransitionKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteExiting, setDeleteExiting] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage>>({});
  const pendingImagesRef = useRef<Record<string, PendingImage>>({});
  const [pinnedTileIds, setPinnedTileIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState("");
  const [noteMenuMode, setNoteMenuMode] = useState<"main" | "move">("main");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [settingsOverlay, setSettingsOverlay] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1080 : true,
  );
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(null);
  const [categoryMenuClosing, setCategoryMenuClosing] = useState(false);
  const [categoryMenuConfirmDelete, setCategoryMenuConfirmDelete] = useState(false);
  const [categoryMenuHoverSuppressed, setCategoryMenuHoverSuppressed] = useState(false);
  const memoEditorRef = useRef<MemoEditorHandle | null>(null);
  const imageBaseDir = useImageBaseDir();
  pendingImagesRef.current = pendingImages;
  const pendingImageUrls = useMemo(() => pendingImageObjectUrls(pendingImages), [pendingImages]);
  const saveStateRef = useRef(saveState);
  const currentWindowLabel = useMemo(() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return "main";
    }
  }, []);
  const isMacOS = useMemo(() => {
    return (
      typeof navigator !== "undefined" &&
      (/Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes("Mac"))
    );
  }, []);
  saveStateRef.current = saveState;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const contentValueRef = useRef(content);
  contentValueRef.current = content;
  const titleValueRef = useRef(title);
  titleValueRef.current = title;
  const loadedUpdatedAtRef = useRef<string | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // 每次"应用/切换当前笔记"都会自增；异步加载完成后若 epoch 已变化，说明用户
  // 已切换到别处，该次结果直接丢弃，避免旧的加载结果覆盖新选中的笔记
  const loadEpoch = useLoadEpoch();
  // 串行化所有保存请求，避免自动保存与切换触发的保存并发写同一篇笔记
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );
  const selectedNoteRef = useRef(selectedNote);
  selectedNoteRef.current = selectedNote;

  const isStructuredMemo = selectedId !== null;

  const noteMenuTarget = useMemo(
    () => notes.find((note) => note.id === noteMenu?.noteId) ?? null,
    [noteMenu?.noteId, notes],
  );
  const noteContextMenuItems = useMemo(() => getNoteContextMenuItems(t), [t]);
  const saveStateLabel = useMemo<Record<SaveState, string>>(
    () => ({
      idle: t("main.statusBar.saveState.idle", { defaultValue: "未选择" }),
      dirty: t("main.statusBar.saveState.dirty", { defaultValue: "未保存" }),
      saving: t("main.statusBar.saveState.saving", { defaultValue: "保存中" }),
      saved: t("main.statusBar.saveState.saved", { defaultValue: "已保存" }),
      error: t("main.statusBar.saveState.error", { defaultValue: "保存失败" }),
    }),
    [t],
  );
  const visibleSidePanel: SidePanelMode | null = aboutOpen
    ? "about"
    : settingsOpen && settingsConfig
      ? "settings"
      : null;
  const sidePanelExpanded = visibleSidePanel !== null;
  const openAboutPanel = useCallback(() => {
    setSettingsOpen(false);
    setAboutOpen(true);
  }, []);

  const filteredNotes = useMemo(() => filterNotes(notes, searchQuery), [notes, searchQuery]);

  const categoryGroups = useMemo(
    () => groupNotesByCategory(filteredNotes, categories),
    [filteredNotes, categories],
  );

  const lineCount = useMemo(
    () => (isStructuredMemo ? memoBlockCount(content) : content.split("\n").length),
    [content, isStructuredMemo],
  );
  const charCount = useMemo(() => countNoteChars(content), [content]);
  const noteFontFamily = useMemo(
    () => resolveNoteFontFamily(settingsConfig?.noteFontFamily),
    [settingsConfig?.noteFontFamily],
  );

  useEffect(() => {
    applyAppFont(settingsConfig?.noteFontFamily);
  }, [settingsConfig?.noteFontFamily]);

  const addPendingImages = useCallback((images: PendingImage[]) => {
    if (images.length === 0) return;
    setPendingImages((current) => ({
      ...current,
      ...Object.fromEntries(images.map((image) => [image.tempId, image])),
    }));
  }, []);

  const insertPendingImagesIntoMemo = useCallback(
    (images: PendingImage[]) => {
      if (images.length === 0) return;
      addPendingImages(images);
      const nextContent = appendMemoBlocks(
        contentValueRef.current,
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
      contentValueRef.current = nextContent;
      setContent(nextContent);
    },
    [addPendingImages],
  );

  const clearPendingImages = useCallback(() => {
    revokePendingImages(Object.values(pendingImagesRef.current));
    pendingImagesRef.current = {};
    setPendingImages({});
  }, []);

  const applyNote = useCallback(
    (note: Note) => {
      // 立刻同步各 ref，保证保存快照与守卫在下一次渲染前就能读到最新值
      const memoContent = serializeMemoDocument(parseMemoContent(note.content));
      loadEpoch.bump();
      selectedIdRef.current = note.id;
      titleValueRef.current = note.title;
      contentValueRef.current = memoContent;
      loadedUpdatedAtRef.current = note.updatedAt;
      saveStateRef.current = "saved";
      setSelectedId(note.id);
      setTitle(note.title);
      setContent(memoContent);
      clearPendingImages();
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
    },
    [loadEpoch, clearPendingImages],
  );

  const replaceNoteMetadata = useCallback((note: Note) => {
    const metadata = metadataFromNote(note);
    setNotes((current) => {
      const exists = current.some((item) => item.id === metadata.id);
      const next = exists
        ? current.map((item) => (item.id === metadata.id ? metadata : item))
        : [metadata, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

  const loadNote = useCallback(
    async (id: string) => {
      const epoch = loadEpoch.bump();
      const note = await getNote(id);
      // 加载期间用户又切换/加载了别的笔记，丢弃本次结果
      if (!loadEpoch.isCurrent(epoch)) return;
      applyNote(note);
      replaceNoteMetadata(note);
    },
    [applyNote, replaceNoteMetadata, loadEpoch],
  );

  const refreshNotes = useCallback(async () => {
    const [loadedNotes, loadedCategories] = await Promise.all([listNotes(), listCategories()]);
    setNotes(loadedNotes);
    setCategories(loadedCategories);
    return loadedNotes;
  }, []);

  const clearCurrentNote = useCallback(() => {
    loadEpoch.bump();
    selectedIdRef.current = null;
    titleValueRef.current = "";
    contentValueRef.current = "";
    loadedUpdatedAtRef.current = null;
    saveStateRef.current = "idle";
    setSelectedId(null);
    setTitle("");
    setContent("");
    clearPendingImages();
    setSaveState("idle");
  }, [loadEpoch, clearPendingImages]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsLoading(true);
      try {
        const [loadedConfig, loadedNotes, loadedCategories] = await Promise.all([
          getConfig(),
          listNotes(),
          listCategories(),
        ]);
        if (cancelled) return;
        setSettingsConfig(loadedConfig);
        setSavedDataDir(loadedConfig.dataDir);
        setNotes(loadedNotes);
        setCategories(loadedCategories);
        setCollapsedCategories(new Set(loadedCategories));
        if (loadedNotes[0]) {
          const note = await getNote(loadedNotes[0].id);
          if (!cancelled) applyNote(note);
        } else {
          clearCurrentNote();
        }
      } catch (error) {
        if (!cancelled) showToast(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, clearCurrentNote]);

  useEffect(() => {
    if (visibleSidePanel) {
      setMountedSidePanel(visibleSidePanel);
      setSidePanelContentVisible(false);

      const frame = window.requestAnimationFrame(() => {
        setSidePanelContentVisible(true);
      });

      return () => window.cancelAnimationFrame(frame);
    }

    setSidePanelContentVisible(false);
    if (!mountedSidePanel) return;

    const timer = window.setTimeout(() => {
      setMountedSidePanel((current) => (current === mountedSidePanel ? null : current));
    }, 320);

    return () => window.clearTimeout(timer);
  }, [mountedSidePanel, visibleSidePanel]);

  useEffect(() => {
    const unlisten = listen<NotesChangedEvent | null>("notes-changed", (event) => {
      // 记录事件到达时的 epoch；其间用户一旦切换/加载了笔记，本次同步即过期，
      // 不再用过期的列表快照去改选中或回填内容，避免把选中"拉回"刚保存的旧笔记
      const epochAtEvent = loadEpoch.peek();
      const isStale = () => !loadEpoch.isCurrent(epochAtEvent);
      void refreshNotes()
        .then((loaded) => {
          if (isStale()) return;
          const currentId = selectedIdRef.current;
          if (!currentId) return;
          const stillExists = loaded.some((n) => n.id === currentId);
          if (stillExists) {
            const hasLocalChanges =
              saveStateRef.current === "dirty" ||
              saveStateRef.current === "saving" ||
              saveStateRef.current === "error";
            const shouldReload = event.payload?.noteId
              ? shouldReloadOpenNote(event.payload, currentId, currentWindowLabel, hasLocalChanges)
              : !hasLocalChanges;
            if (shouldReload) {
              void getNote(currentId)
                .then((note) => {
                  if (isStale()) return;
                  if (selectedIdRef.current !== currentId) return;
                  if (
                    saveStateRef.current === "dirty" ||
                    saveStateRef.current === "saving" ||
                    saveStateRef.current === "error"
                  ) {
                    return;
                  }
                  const memoContent = serializeMemoDocument(parseMemoContent(note.content));
                  titleValueRef.current = note.title;
                  contentValueRef.current = memoContent;
                  loadedUpdatedAtRef.current = note.updatedAt;
                  saveStateRef.current = "saved";
                  setTitle(note.title);
                  setContent(memoContent);
                  setSaveState("saved");
                })
                .catch(() => undefined);
            }
          } else if (selectedNoteRef.current) {
            if (loaded[0]) {
              void loadNote(loaded[0].id);
            } else {
              clearCurrentNote();
            }
          }
        })
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes, loadNote, clearCurrentNote, loadEpoch, currentWindowLabel]);

  useEffect(() => {
    function handleFocus() {
      void refreshNotes();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshNotes]);

  useEffect(() => {
    const onResize = () => setSettingsOverlay(window.innerWidth < 1080);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const imagePaths = event.payload.paths.filter((path) => IMAGE_RE.test(path));
      if (imagePaths.length > 0 && selectedIdRef.current) {
        void (async () => {
          try {
            const pending = await Promise.all(
              imagePaths.map(async (p) => createPendingImage(await readExternalImage(p))),
            );
            if (memoEditorRef.current) memoEditorRef.current.insertImages(pending);
            else insertPendingImagesIntoMemo(pending);
            saveStateRef.current = "dirty";
            setSaveState("dirty");
          } catch (error) {
            showToast(getErrorMessage(error));
          }
        })();
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [insertPendingImagesIntoMemo]);

  useEffect(() => {
    const unlisten = listen<string>("open-note", (event) => {
      void loadNote(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadNote]);

  useEffect(() => {
    const unlisten = listen("open-about-panel", () => {
      openAboutPanel();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openAboutPanel]);

  useEffect(() => {
    const unlisten = listen<string>("shortcut-register-failed", (event) => {
      showToast(event.payload, "warning");
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>(TILE_WINDOW_CLOSED_EVENT, (event) => {
      setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>(TILE_WINDOW_UNPINNED_EVENT, (event) => {
      setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    function closeMenus() {
      setNoteMenuClosing(true);
      setCategoryMenuClosing(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
    }

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!noteMenuClosing || !noteMenu) return;
    const timer = window.setTimeout(() => {
      setNoteMenu(null);
      setNoteMenuClosing(false);
      setNoteMenuMode("main");
    }, 150);
    return () => window.clearTimeout(timer);
  }, [noteMenuClosing, noteMenu]);

  useEffect(() => {
    if (!categoryMenuClosing || !categoryMenu) return;
    const timer = window.setTimeout(() => {
      setCategoryMenu(null);
      setCategoryMenuClosing(false);
      setCategoryMenuConfirmDelete(false);
      setCategoryMenuHoverSuppressed(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [categoryMenuClosing, categoryMenu]);

  useEffect(() => {
    if (!categoryMenuHoverSuppressed || !categoryMenu) return;
    const releaseHover = () => setCategoryMenuHoverSuppressed(false);
    window.addEventListener("mousemove", releaseHover, { once: true });
    window.addEventListener("mousedown", releaseHover, { once: true });
    return () => {
      window.removeEventListener("mousemove", releaseHover);
      window.removeEventListener("mousedown", releaseHover);
    };
  }, [categoryMenuHoverSuppressed, categoryMenu]);

  const switchCategoryMenuPanel = useCallback((confirmDelete: boolean) => {
    setCategoryMenuHoverSuppressed(true);
    setCategoryMenuConfirmDelete(confirmDelete);
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  const persistPendingImages = useCallback(async (noteId: string, snapshot: string) => {
    const ids = extractPendingImageIds(snapshot);
    if (ids.length === 0) {
      return { content: snapshot, replacements: {} as Record<string, string> };
    }

    const replacements: Record<string, string> = {};
    const savedImages: PendingImage[] = [];
    for (const id of ids) {
      const image = pendingImagesRef.current[id];
      if (!image) continue;
      replacements[id] = await saveImage(noteId, image.data, image.extension);
      savedImages.push(image);
    }

    if (Object.keys(replacements).length === 0) {
      return { content: snapshot, replacements };
    }
    const nextContent = replacePendingImageRefs(snapshot, replacements);
    setPendingImages((current) => {
      const next = { ...current };
      for (const image of savedImages) {
        delete next[image.tempId];
      }
      pendingImagesRef.current = next;
      return next;
    });
    revokePendingImages(savedImages);
    return { content: nextContent, replacements };
  }, []);

  const performSave = useCallback(
    async (force: boolean): Promise<boolean> => {
      // 非强制保存（自动保存、切换前保存）在没有未保存修改时直接视为成功
      if (!force && saveStateRef.current !== "dirty") return true;
      const id = selectedIdRef.current;
      if (!id) return false;

      // 在保存瞬间对当前笔记做快照；之后用户切换笔记不影响本次写入的内容，
      // 保存完成后也只在"仍停留在这篇笔记"时才更新保存状态
      const titleSnapshot = titleValueRef.current;
      const contentSnapshot = contentValueRef.current;
      const stillCurrent = () => selectedIdRef.current === id;
      const settleSaveState = (state: SaveState) => {
        if (!stillCurrent()) return;
        saveStateRef.current = state;
        setSaveState(state);
      };

      settleSaveState("saving");
      try {
        const category = notesRef.current.find((note) => note.id === id)?.category ?? "";
        const { content: persistedContent, replacements } = await persistPendingImages(
          id,
          contentSnapshot,
        );
        if (persistedContent !== contentSnapshot && stillCurrent()) {
          const currentContent = replacePendingImageRefs(contentValueRef.current, replacements);
          contentValueRef.current = currentContent;
          setContent(currentContent);
        }
        const note = await updateNote(
          id,
          {
            title: titleSnapshot,
            content: persistedContent,
            category,
          },
          loadedUpdatedAtRef.current,
        );
        loadedUpdatedAtRef.current = note.updatedAt;
        replaceNoteMetadata(note);
        const contentChanged =
          contentValueRef.current !== persistedContent || titleValueRef.current !== titleSnapshot;
        settleSaveState(contentChanged ? "dirty" : "saved");
        return true;
      } catch (error) {
        settleSaveState("error");
        showToast(getErrorMessage(error));
        return false;
      }
    },
    [replaceNoteMetadata, persistPendingImages],
  );

  const saveCurrentNote = useCallback(
    (force = false): Promise<boolean> => {
      const run = saveQueueRef.current.then(() => performSave(force));
      saveQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [performSave],
  );

  useEffect(() => {
    if (!settingsConfig?.noteAutoSave || !selectedId || saveState !== "dirty") return;
    const timer = window.setTimeout(() => {
      void saveCurrentNote();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, saveCurrentNote, saveState, selectedId, settingsConfig?.noteAutoSave, title]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void saveCurrentNote(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveCurrentNote]);

  const handleNewNote = async () => {
    await saveCurrentNote();
    try {
      const note = await createNote({
        title: "",
        content: createEmptyMemoContent(),
        category: activeCategory,
      });
      replaceNoteMetadata(note);
      applyNote(note);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenSettings = async () => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    setSettingsOpen(true);
    setAboutOpen(false);
    if (settingsConfig) return;
    try {
      const config = await getConfig();
      setSettingsConfig(config);
      setSavedDataDir(config.dataDir);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleMigrateDataDir = async () => {
    if (!settingsConfig) return;
    try {
      const dir = await chooseDataDirectory();
      if (!dir) return;
      // 后端会在所选目录下创建 floral 子目录存放数据；先告知用户，
      // 避免其在文件管理器打开所选目录看到"空文件夹"而误判数据丢失
      const confirmed = window.confirm(
        t("settings.dataDir.confirmSubdir", {
          dir,
          defaultValue: "数据将存放在「{{dir}}」下的 floral 子文件夹中，是否继续？",
        }),
      );
      if (!confirmed) return;
      const savedConfig = await migrateDataDir(dir);
      setSettingsConfig(savedConfig);
      setSavedDataDir(savedConfig.dataDir);
      const loadedNotes = await refreshNotes();
      if (loadedNotes[0]) {
        await loadNote(loadedNotes[0].id);
      } else {
        clearCurrentNote();
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSettings = useCallback(
    (nextConfig: AppConfig) => {
      if (settingsSaveTimer.current) {
        clearTimeout(settingsSaveTimer.current);
      }
      settingsSaveTimer.current = setTimeout(async () => {
        const previousDataDir = savedDataDir ?? nextConfig.dataDir;
        const normalizedConfig = {
          ...nextConfig,
          tileColor: normalizeTileColor(nextConfig.tileColor),
        };
        try {
          const savedConfig = await saveConfig(normalizedConfig);
          setSettingsConfig(savedConfig);
          setSavedDataDir(savedConfig.dataDir);

          if (savedConfig.dataDir !== previousDataDir) {
            const loadedNotes = await refreshNotes();
            if (loadedNotes[0]) {
              await loadNote(loadedNotes[0].id);
            } else {
              clearCurrentNote();
            }
          }
        } catch (error) {
          showToast(getErrorMessage(error));
        }
      }, 300);
    },
    [savedDataDir, refreshNotes, loadNote, clearCurrentNote],
  );

  const handleSettingsChange = useCallback(
    (nextConfig: AppConfig) => {
      setSettingsConfig(nextConfig);
      void emit("config-changed", nextConfig);
      persistSettings(nextConfig);
    },
    [persistSettings],
  );

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleOpenAbout = useCallback(() => {
    setAboutOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setSettingsOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const handleCloseAbout = useCallback(() => {
    setAboutOpen(false);
  }, []);

  const handleSelectNote = async (id: string) => {
    if (id === selectedId) return;
    setDeleteConfirm(false);
    // 排队保存：等待可能在途的自动保存，并把尚未落盘的修改一并存掉
    await saveCurrentNote();

    setIsLoading(true);
    try {
      await loadNote(id);
    } catch (error) {
      showToast(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteNote = async (noteId = selectedId) => {
    if (!noteId) return;

    setDeleteConfirm(false);
    try {
      await deleteNote(noteId);
      const remaining = await refreshNotes();
      if (noteId === selectedId && remaining[0]) {
        await loadNote(remaining[0].id);
      } else if (noteId === selectedId) {
        clearCurrentNote();
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleOpenNoteMenu = (event: MouseEvent<HTMLElement>, noteId: string) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 168;
    const menuHeight = 104;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 4);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 4);

    setNoteMenuClosing(false);
    setHoveredId(noteId);
    setNoteMenu({
      x: Math.max(4, x),
      y: Math.max(4, y),
      noteId,
    });
  };

  const handleExportNote = async (noteId: string, noteTitle: string) => {
    const exportTitle = noteId === selectedIdRef.current ? titleValueRef.current : noteTitle;
    try {
      const path = await chooseMarkdownExportPath(
        exportTitle || t("common.untitledNote", { defaultValue: "无标题便签" }),
      );
      if (!path) return;

      if (noteId === selectedIdRef.current) {
        const saved = await saveCurrentNote(saveStateRef.current === "error");
        if (!saved) return;
      }

      await exportNoteMarkdown(noteId, path);
      showToast(t("noteMenu.exported", { defaultValue: "Markdown 已导出" }), "info");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleNoteMenuAction = (action: NoteContextMenuAction) => {
    const note = noteMenuTarget;
    if (!note) return;

    if (action === "move") {
      setNoteMenuMode("move");
      return;
    }

    setNoteMenuClosing(true);
    if (action === "export") {
      void handleExportNote(note.id, note.title);
      return;
    }

    void handleDeleteNote(note.id);
  };

  const handleMoveNote = async (noteId: string, targetCategory: string) => {
    setNoteMenuClosing(true);
    try {
      await moveNoteCategory(noteId, targetCategory);
      await refreshNotes();
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleCreateCategory = async () => {
    const name = categoryInputValue.trim();
    if (!name) {
      setShowCategoryInput(false);
      return;
    }
    try {
      await createCategory(name);
      setCategories((prev) => [...prev, name].sort());
      setShowCategoryInput(false);
      setCategoryInputValue("");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleRenameCategory = async (oldName: string) => {
    const newName = renameCategoryValue.trim();
    if (!newName || newName === oldName) {
      setRenamingCategory(null);
      return;
    }

    try {
      await renameCategory(oldName, newName);
      await refreshNotes();
      setRenamingCategory(null);
      setRenameCategoryValue("");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleDeleteCategory = async (name: string) => {
    try {
      await deleteCategory(name);
      await refreshNotes();
      if (activeCategory === name) {
        setActiveCategory("");
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const markDirty = () => {
    if (!selectedId) return;
    saveStateRef.current = "dirty";
    setSaveState("dirty");
  };

  const handleImportImage = async () => {
    if (!selectedId) return;
    try {
      const filePath = await chooseNoteImage();
      if (!filePath) return;
      const imageData = await readExternalImage(filePath);
      const pendingImage = createPendingImage(imageData);
      if (memoEditorRef.current) memoEditorRef.current.insertImages([pendingImage]);
      else insertPendingImagesIntoMemo([pendingImage]);
      markDirty();
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleClearNoteContent = () => {
    if (!selectedId) return;
    const nextContent = createEmptyMemoContent();
    setContent(nextContent);
    contentValueRef.current = nextContent;
    revokePendingImages(Object.values(pendingImagesRef.current));
    pendingImagesRef.current = {};
    setPendingImages({});
    markDirty();
    setClearConfirm(false);
  };

  const handleCleanUnusedImages = async () => {
    if (!selectedId) return;
    try {
      const removed = await cleanUnusedImages(selectedId, content);
      if (removed.length > 0) {
        showToast(
          t("main.images.cleaned", {
            count: removed.length,
            defaultValue: "已清理 {{count}} 张图片",
          }),
          "info",
        );
      } else {
        showToast(t("main.images.cleanedNone", { defaultValue: "没有需要清理的图片" }), "info");
      }
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleUndo = () => {
    if (!selectedId) return;
    memoEditorRef.current?.undo();
  };

  const handleRedo = () => {
    if (!selectedId) return;
    memoEditorRef.current?.redo();
  };

  const handleOpenNotepad = async () => {
    try {
      await openNotepadWindow();
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void isCurrentWindowMaximized().then(setIsMaximized);
    const unlisten = getCurrentWindow().onResized(() => {
      void isCurrentWindowMaximized().then(setIsMaximized);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 180), 500);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => setIsResizingSidebar(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingSidebar]);

  const handlePinEntry = async () => {
    if (!selectedId) return;
    const isPinned = pinnedTileIds.has(selectedId);
    if (!isPinned) {
      await saveCurrentNote();
    }
    try {
      const pinned = await toggleTileWindow(selectedId);
      setPinnedTileIds((previous) => {
        return syncPinnedTileIds(previous, selectedId, pinned);
      });
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const selectedTilePinned = selectedId ? pinnedTileIds.has(selectedId) : false;

  const toggleMaximize = () => {
    void toggleMaximizeCurrentWindow().then(() => isCurrentWindowMaximized().then(setIsMaximized));
  };

  const handleTitleBarMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (event.button !== 0) return;
    if (event.detail === 2) {
      toggleMaximize();
      return;
    }
    void startCurrentWindowDrag().catch(() => undefined);
  };

  const handleMinimize = () => {
    void minimizeCurrentWindow();
  };

  const handleMaximize = () => {
    toggleMaximize();
  };

  const handleClose = () => {
    void closeCurrentWindow();
  };
  const aboutButtonTitle = t("main.window.about", { defaultValue: "关于" });

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="relative noise-bg bg-cloud overflow-hidden flex flex-col flex-1">
        <BackgroundLayer config={settingsConfig} />
        <div
          className={`relative z-10 flex items-center justify-between h-11 bg-paper/55 backdrop-blur-[1px] border-b border-paper-deep/30 shrink-0 select-none cursor-default ${
            isMacOS ? "pl-20 pr-5" : "pl-5 pr-0"
          }`}
          onMouseDown={handleTitleBarMouseDown}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[15px] font-serif font-medium text-ink-soft tracking-wide leading-none">
              花笺
            </span>
            <span className="text-[11px] text-ink-ghost font-body leading-none translate-y-px">
              —
            </span>
            <span className="text-[11px] text-ink-faint font-body truncate max-w-[240px] leading-none translate-y-px">
              {title ||
                selectedNote?.preview ||
                t("common.untitledNote", { defaultValue: "无标题便签" })}
            </span>
          </div>
          <div className="flex items-center">
            <button
              onClick={() => void handleOpenNotepad()}
              className="w-10 h-11 flex items-center justify-center text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer"
              title={t("main.window.quickNotepad", { defaultValue: "快捷便签" })}
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
                <path d="M4 4h16v14H7l-3 3V4z" />
                <path d="M8 9h8M8 13h5" />
              </svg>
            </button>
            <button
              onClick={() => void handleOpenSettings()}
              className="w-10 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
              title={t("main.window.settings", { defaultValue: "设置" })}
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
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              onClick={handleOpenAbout}
              className="w-10 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
              title={aboutButtonTitle}
              aria-label={aboutButtonTitle}
            >
              <svg
                data-testid="main-about-info-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>

            {!isMacOS && (
              <>
                <div className="w-px h-4 bg-paper-deep/30 mx-0.5" />

                <button
                  onClick={handleMinimize}
                  className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                  title={t("main.window.minimize", { defaultValue: "最小化" })}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <rect x="1" y="5.5" width="10" height="1" fill="currentColor" rx="0.5" />
                  </svg>
                </button>
                <button
                  onClick={handleMaximize}
                  className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-all cursor-pointer"
                  title={
                    isMaximized
                      ? t("main.window.restore", { defaultValue: "还原" })
                      : t("main.window.maximize", { defaultValue: "最大化" })
                  }
                >
                  {isMaximized ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <path d="M3 5H2V2a1 1 0 0 1 1-1h5v1" />
                    </svg>
                  ) : (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    >
                      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={handleClose}
                  className="w-11 h-11 flex items-center justify-center text-ink-ghost hover:text-red-500 hover:bg-danger-bg transition-all cursor-pointer"
                  title={t("main.window.close", { defaultValue: "关闭" })}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="relative z-10 flex flex-1 min-h-0">
          <div
            className="border-r border-paper-deep/30 bg-paper/40 shrink-0 overflow-hidden transition-[width] duration-[600ms]"
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          >
            <div className="flex flex-col h-full" style={{ width: `${sidebarWidth}px` }}>
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-paper-warm/80 border border-paper-deep/40 focus-within:border-bamboo/30 focus-within:bg-cloud transition-all">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="text-ink-ghost shrink-0"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("main.sidebar.searchPlaceholder", {
                      defaultValue: "搜索便签…",
                    })}
                    className="flex-1 text-[12px] font-body text-ink placeholder:text-ink-ghost/60 bg-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
                      title={t("main.sidebar.clearSearch", { defaultValue: "清空搜索" })}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="px-3 pb-2 shrink-0 space-y-1">
                <button
                  onClick={handleNewNote}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-bamboo hover:bg-bamboo-mist/60 transition-all cursor-pointer group"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="group-hover:rotate-90 transition-transform duration-200"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{t("main.sidebar.newNote", { defaultValue: "新建便签" })}</span>
                </button>
              </div>

              <div className="flex items-center justify-between px-5 pb-1.5 shrink-0">
                <span className="text-[10px] text-ink-ghost font-mono tracking-wider uppercase">
                  {t("common.noteCount", {
                    count: filteredNotes.length,
                    defaultValue: "{{count}} 张便签",
                  })}
                </span>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (showCategoryInput && categoryInputValue.trim()) {
                      void handleCreateCategory();
                      return;
                    }
                    setShowCategoryInput(true);
                  }}
                  className="text-[10px] text-ink-ghost hover:text-bamboo transition-colors cursor-pointer"
                  title={t("main.category.new", { defaultValue: "新建分类" })}
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
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>

              {showCategoryInput && (
                <div className="px-3 pb-2 shrink-0">
                  <input
                    type="text"
                    autoFocus
                    value={categoryInputValue}
                    onChange={(e) => setCategoryInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateCategory();
                      if (e.key === "Escape") {
                        setShowCategoryInput(false);
                        setCategoryInputValue("");
                      }
                    }}
                    onBlur={() => void handleCreateCategory()}
                    placeholder={t("main.category.placeholder", { defaultValue: "输入分类名…" })}
                    className="w-full px-2.5 h-7 rounded-lg text-[12px] font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/60"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-2 pb-2">
                <div className="space-y-0.5">
                  {categoryGroups.map((group: CategoryGroup) => {
                    if (!group.category) {
                      return (
                        <div
                          key="__uncategorized__"
                          className={`rounded-lg transition-all duration-200 ${
                            dragOverCategory === "" ? "bg-bamboo/10 ring-1 ring-bamboo/20" : ""
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCategory("");
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setDragOverCategory(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverCategory(null);
                            const noteId = e.dataTransfer.getData("text/plain");
                            if (noteId) void handleMoveNote(noteId, "");
                          }}
                        >
                          {group.notes.map((note) => {
                            const isSelected = note.id === selectedId;
                            const isHovered = note.id === hoveredId;
                            return (
                              <div
                                key={note.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/plain", note.id);
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onClick={() => void handleSelectNote(note.id)}
                                onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                onMouseEnter={() => setHoveredId(note.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-pointer group relative ${
                                  isSelected
                                    ? "bg-bamboo-mist/70"
                                    : isHovered
                                      ? "bg-paper-warm/70"
                                      : "bg-transparent"
                                }`}
                              >
                                <div
                                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                    isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                  }`}
                                />
                                <div className="flex items-baseline justify-between mb-0.5">
                                  <span
                                    className={`text-[13px] font-display font-medium truncate pr-2 transition-colors ${
                                      isSelected ? "text-bamboo" : "text-ink-soft"
                                    }`}
                                  >
                                    {getDisplayTitle(note, t)}
                                  </span>
                                  <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0">
                                    {formatShortDate(note.updatedAt)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors">
                                  {note.preview ||
                                    t("common.blankNote", { defaultValue: "空白便签" })}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                    {formatTime(note.updatedAt)}
                                  </span>
                                  <span className="text-[10px] text-ink-ghost/40">·</span>
                                  <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                    {t("common.wordCount", {
                                      count: note.wordCount,
                                      defaultValue: "{{count}} 字",
                                    })}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    const isCollapsed = collapsedCategories.has(group.category);

                    return (
                      <div key={group.category} className="px-2 mb-0.5">
                        <div
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg group/cat cursor-pointer select-none transition-all duration-200 ${
                            dragOverCategory === group.category
                              ? "bg-bamboo/15 border border-bamboo/40 ring-1 ring-bamboo/20"
                              : isCollapsed
                                ? "bg-transparent border border-bamboo/15"
                                : "bg-bamboo/8 border border-bamboo/15 rounded-b-none"
                          }`}
                          onClick={() => toggleCategoryCollapse(group.category)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCategoryMenu({
                              x: e.clientX,
                              y: e.clientY,
                              category: group.category,
                            });
                            setCategoryMenuClosing(false);
                            setCategoryMenuConfirmDelete(false);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCategory(group.category);
                          }}
                          onDragLeave={() => setDragOverCategory(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverCategory(null);
                            const noteId = e.dataTransfer.getData("text/plain");
                            if (noteId) void handleMoveNote(noteId, group.category);
                          }}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`text-bamboo/50 shrink-0 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-bamboo/50 shrink-0"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          {renamingCategory === group.category ? (
                            <input
                              type="text"
                              autoFocus
                              value={renameCategoryValue}
                              onChange={(e) => setRenameCategoryValue(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") void handleRenameCategory(group.category);
                                if (e.key === "Escape") setRenamingCategory(null);
                              }}
                              onBlur={() => void handleRenameCategory(group.category)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 px-1 text-[10px] font-mono text-ink bg-paper-warm/80 border border-bamboo/30 rounded"
                            />
                          ) : (
                            <span className="text-[11px] text-bamboo/70 font-medium truncate">
                              {group.category}
                            </span>
                          )}
                          <span className="text-[9px] text-bamboo/40 font-mono ml-auto shrink-0">
                            {group.notes.length}
                          </span>
                        </div>

                        <div className={`category-body ${isCollapsed ? "" : "expanded"}`}>
                          <div
                            className="category-body-inner bg-bamboo/[0.03] border border-t-0 border-bamboo/10 rounded-b-lg pb-1 pt-1"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverCategory(group.category);
                            }}
                            onDragLeave={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                setDragOverCategory(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOverCategory(null);
                              const noteId = e.dataTransfer.getData("text/plain");
                              if (noteId) void handleMoveNote(noteId, group.category);
                            }}
                          >
                            {group.notes.length === 0 ? (
                              <div className="px-3 py-3 text-center text-[11px] text-ink-ghost/50">
                                {t("main.category.emptyFolder", { defaultValue: "空文件夹" })}
                              </div>
                            ) : (
                              group.notes.map((note) => {
                                const isSelected = note.id === selectedId;
                                const isHovered = note.id === hoveredId;

                                return (
                                  <div
                                    key={note.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", note.id);
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onClick={() => void handleSelectNote(note.id)}
                                    onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                    onMouseEnter={() => setHoveredId(note.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    className={`w-full text-left rounded-lg mx-1 px-2.5 py-2 transition-all duration-[600ms] cursor-pointer group relative ${
                                      isSelected
                                        ? "bg-bamboo-mist/70"
                                        : isHovered
                                          ? "bg-paper-warm/70"
                                          : "bg-transparent"
                                    }`}
                                    style={{ width: "calc(100% - 8px)" }}
                                  >
                                    <div
                                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                        isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                      }`}
                                    />

                                    <div className="flex items-baseline justify-between mb-0.5">
                                      <span
                                        className={`text-[13px] font-display font-medium truncate pr-2 transition-colors ${
                                          isSelected ? "text-bamboo" : "text-ink-soft"
                                        }`}
                                      >
                                        {getDisplayTitle(note, t)}
                                      </span>
                                      <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0">
                                        {formatShortDate(note.updatedAt)}
                                      </span>
                                    </div>

                                    <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors">
                                      {note.preview ||
                                        t("common.blankNote", { defaultValue: "空白便签" })}
                                    </p>

                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {formatTime(note.updatedAt)}
                                      </span>
                                      <span className="text-[10px] text-ink-ghost/40">·</span>
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {t("common.wordCount", {
                                          count: note.wordCount,
                                          defaultValue: "{{count}} 字",
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!isLoading && filteredNotes.length === 0 && (
                    <div className="px-3 py-8 text-center text-[12px] text-ink-ghost leading-relaxed">
                      {searchQuery
                        ? t("main.search.noResults", { defaultValue: "没有匹配的便签" })
                        : t("main.search.empty", { defaultValue: "还没有便签" })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!sidebarCollapsed && (
            <div
              className={`w-1 shrink-0 cursor-col-resize group relative ${isResizingSidebar ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingSidebar(true);
              }}
            >
              <div
                className={`absolute inset-y-0 -left-1 -right-1 ${isResizingSidebar ? "" : "group-hover:bg-bamboo/5"}`}
              />
            </div>
          )}

          <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 h-10 border-b border-paper-deep/20 shrink-0 bg-paper/20">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                  title={
                    sidebarCollapsed
                      ? t("main.window.expandSidebar", { defaultValue: "展开侧栏" })
                      : t("main.window.collapseSidebar", { defaultValue: "收起侧栏" })
                  }
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
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                </button>

                <div className="h-4 w-px bg-paper-deep/30 mx-1" />

                <button
                  onClick={() => void handlePinEntry()}
                  disabled={!selectedId}
                  aria-label={pinTileButtonTitle(selectedTilePinned)}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    selectedTilePinned
                      ? "text-bamboo bg-bamboo-mist/40 hover:text-red-400 hover:bg-danger-bg"
                      : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
                  }`}
                  title={pinTileButtonTitle(selectedTilePinned)}
                >
                  <svg
                    width="13"
                    height="13"
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
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleUndo}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("main.editor.undo", { defaultValue: "撤销（Ctrl+Z）" })}
                  aria-label={t("main.editor.undoLabel", { defaultValue: "撤销" })}
                >
                  <svg
                    data-testid="main-editor-undo-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
                  </svg>
                </button>

                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleRedo}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("main.editor.redo", { defaultValue: "重做（Ctrl+Y）" })}
                  aria-label={t("main.editor.redoLabel", { defaultValue: "重做" })}
                >
                  <svg
                    data-testid="main-editor-redo-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ transform: "scaleX(-1)" }}
                  >
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
                  </svg>
                </button>

                <span className="h-4 w-px bg-paper-deep/50 mx-0.5" />

                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => memoEditorRef.current?.toggleBold()}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg font-bold text-[13px] text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("memo.bold", { defaultValue: "加粗" })}
                  aria-label={t("memo.bold", { defaultValue: "加粗" })}
                >
                  B
                </button>

                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => memoEditorRef.current?.toggleItalic()}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg italic font-serif text-[13px] text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("memo.italic", { defaultValue: "斜体" })}
                  aria-label={t("memo.italic", { defaultValue: "斜体" })}
                >
                  I
                </button>

                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => memoEditorRef.current?.toggleUnderline()}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg underline text-[13px] text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("memo.underline", { defaultValue: "下划线" })}
                  aria-label={t("memo.underline", { defaultValue: "下划线" })}
                >
                  U
                </button>

                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => memoEditorRef.current?.toggleTodo()}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("memo.toggleTodo", { defaultValue: "切换待办" })}
                  aria-label={t("memo.toggleTodo", { defaultValue: "切换待办" })}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="5" height="5" rx="1" />
                    <path d="M10.5 5.5H17M10.5 13.5H17M3 13.5h5" />
                  </svg>
                </button>

                <span className="h-4 w-px bg-paper-deep/50 mx-0.5" />

                <button
                  type="button"
                  onClick={() => void handleImportImage()}
                  disabled={!selectedId}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("main.images.import", { defaultValue: "导入图片" })}
                  aria-label={t("main.images.import", { defaultValue: "导入图片" })}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="8.5" cy="9" r="1.5" />
                    <path d="m4 17 5-5 4 4 2.5-2.5L20 18" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => void saveCurrentNote(true)}
                  disabled={!selectedId || saveState === "saving"}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("common.save", { defaultValue: "保存" })}
                  aria-label={t("common.save", { defaultValue: "保存" })}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 3h12l2 2v16H5Z" />
                    <path d="M8 3v6h8V3M8 21v-7h8v7" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (selectedNote) void handleExportNote(selectedNote.id, selectedNote.title);
                  }}
                  disabled={!selectedNote || saveState === "saving"}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("noteMenu.export", { defaultValue: "导出 Markdown" })}
                  aria-label={t("noteMenu.export", { defaultValue: "导出 Markdown" })}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                </button>

                {clearConfirm ? (
                  <div className="flex items-center gap-1 ml-1 animate-delete-confirm">
                    <span className="sr-only">
                      {t("main.editor.confirmClear", { defaultValue: "确认清空？" })}
                    </span>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleClearNoteContent}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-cloud bg-amber-500 hover:bg-amber-600 transition-colors cursor-pointer outline-none"
                    >
                      <span aria-hidden="true">✓</span>
                    </button>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setClearConfirm(false)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-faint hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer outline-none"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClearConfirm(true)}
                    disabled={
                      !selectedId || (isStructuredMemo ? !memoHasContent(content) : !content)
                    }
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-amber-500 hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t("main.editor.clearContent", { defaultValue: "清空正文" })}
                    aria-label={t("main.editor.clearContent", { defaultValue: "清空正文" })}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m4 15 8-10 8 7-6 8H8Z" />
                      <path d="m10 20 7-9" />
                    </svg>
                  </button>
                )}

                {deleteConfirm ? (
                  <div
                    className={`flex items-center gap-1 ml-1 ${deleteExiting ? "animate-delete-confirm-exit" : "animate-delete-confirm"}`}
                  >
                    <span className="sr-only">
                      {t("main.editor.confirmDelete", { defaultValue: "确认删除？" })}
                    </span>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDeleteExiting(true);
                        setTimeout(() => {
                          setDeleteExiting(false);
                          setDeleteConfirm(false);
                          void handleDeleteNote();
                        }, 150);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-cloud bg-red-400 hover:bg-red-500 transition-colors cursor-pointer outline-none"
                    >
                      <span aria-hidden="true">✓</span>
                    </button>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDeleteExiting(true);
                        setTimeout(() => {
                          setDeleteExiting(false);
                          setDeleteConfirm(false);
                        }, 150);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-faint hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer outline-none"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    disabled={!selectedId}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-red-400 hover:bg-danger-bg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t("noteMenu.delete", { defaultValue: "删除便签" })}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3,6 5,6 21,6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>

              <span
                className="w-7 h-7 mr-1 flex items-center justify-center rounded-lg text-bamboo/65"
                title={t("main.editor.quickMemo", { defaultValue: "快捷便签" })}
                aria-label={t("main.editor.quickMemo", { defaultValue: "快捷便签" })}
                role="img"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 3h12a2 2 0 0 1 2 2v11l-5 5H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                  <path d="M15 21v-5h5M8 8h8M8 12h5" />
                </svg>
              </span>
            </div>

            <div
              key={`note-header-${noteTransitionKey}`}
              className="animate-note-enter px-6 pt-4 pb-2 shrink-0 border-b border-paper-deep/15"
            >
              <input
                type="text"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  markDirty();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    memoEditorRef.current?.focus();
                  }
                }}
                placeholder={t("main.editor.memoTitlePlaceholder", {
                  defaultValue: "便签标题（可选）",
                })}
                disabled={!selectedId}
                className="w-full text-[20px] font-display font-bold text-bamboo placeholder:text-ink-ghost/50 tracking-wide disabled:opacity-60"
              />
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-[10px] text-ink-ghost font-mono tabular-nums truncate max-w-[200px]">
                  {selectedNote
                    ? `${formatShortDate(selectedNote.updatedAt)} ${formatTime(selectedNote.updatedAt)}`
                    : "--"}
                </span>
                <span className="text-[10px] text-ink-ghost/40">·</span>
                <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                  {t("common.wordCount", { count: charCount, defaultValue: "{{count}} 字" })}
                </span>
                <span className="text-[10px] text-ink-ghost/40">·</span>
                <span
                  key={saveState}
                  className={`text-[10px] font-mono tabular-nums animate-status-fade ${
                    saveState === "error"
                      ? "text-red-400"
                      : saveState === "dirty"
                        ? "text-amber-500/70"
                        : "text-bamboo/60"
                  }`}
                >
                  {saveStateLabel[saveState]}
                </span>
              </div>
            </div>

            <div
              key={`note-editor-${noteTransitionKey}`}
              className="flex-1 flex min-h-0 animate-view-fade"
            >
              {!selectedId && !isLoading ? (
                <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
                  {t("main.editor.emptyHint", { defaultValue: "选择或新建一张便签" })}
                </div>
              ) : (
                <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 pt-3 pb-2">
                  <MemoEditor
                    ref={memoEditorRef}
                    value={content}
                    onChange={(nextContent) => {
                      contentValueRef.current = nextContent;
                      setContent(nextContent);
                    }}
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
                    fontSize={settingsConfig?.fontSize ?? 14}
                    fontFamily={noteFontFamily}
                    placeholder={t("main.editor.memoPlaceholder", {
                      defaultValue: "记录此刻要记住的事……",
                    })}
                    disabled={!selectedId}
                    showToolbar={false}
                    onError={showToast}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-4 h-7 border-t border-paper-deep/20 bg-paper/30 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
                  {t("main.statusBar.blockCount", {
                    count: lineCount,
                    defaultValue: "{{count}} 个内容块",
                  })}
                </span>
                <span className="text-[10px] text-ink-ghost/40">|</span>
                <span className="text-[10px] text-ink-ghost font-mono">
                  {t("main.statusBar.memoFormat", { defaultValue: "快捷便签" })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {selectedId && content.includes("images/") && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleCleanUnusedImages()}
                      className="text-[10px] text-ink-ghost hover:text-bamboo font-mono cursor-pointer transition-colors"
                    >
                      {t("main.images.cleanUnused", { defaultValue: "清理未使用图片" })}
                    </button>
                    <span className="text-[10px] text-ink-ghost/40">|</span>
                  </>
                )}
                <span className="text-[10px] text-ink-ghost font-mono">
                  {t("main.statusBar.localMemo", { defaultValue: "本地便签" })}
                </span>
              </div>
            </div>
          </div>
          {settingsConfig && settingsOpen && settingsOverlay && (
            <div className="absolute inset-0 z-20" onClick={handleCloseSettings} />
          )}
          <div
            className={`relative shrink-0 overflow-hidden h-full transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              sidePanelExpanded || mountedSidePanel ? "border-l border-paper-deep/20" : "border-l-0"
            } ${
              settingsOverlay
                ? `absolute right-0 top-0 bottom-0 z-30 ${visibleSidePanel ? "w-[360px] shadow-xl" : "w-0"}`
                : `${sidePanelExpanded ? "w-[360px]" : "w-0"}`
            }`}
          >
            <div
              className={`absolute inset-0 w-[360px] h-full transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                mountedSidePanel === "about"
                  ? sidePanelContentVisible && visibleSidePanel === "about"
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-4 opacity-0"
                  : "pointer-events-none translate-x-4 opacity-0"
              }`}
            >
              {mountedSidePanel === "about" ? <AboutPanel onClose={handleCloseAbout} /> : null}
            </div>
            <div
              className={`absolute inset-0 w-[360px] h-full transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                mountedSidePanel === "settings"
                  ? sidePanelContentVisible && visibleSidePanel === "settings"
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-4 opacity-0"
                  : "pointer-events-none translate-x-4 opacity-0"
              }`}
            >
              {mountedSidePanel === "settings" && settingsConfig ? (
                <SettingsPanel
                  config={settingsConfig}
                  onChange={handleSettingsChange}
                  onMigrateDataDir={() => void handleMigrateDataDir()}
                  onClose={handleCloseSettings}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {noteMenu && noteMenuTarget && (
        <div
          className={`popup-menu fixed z-[9999] min-w-[168px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${noteMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ left: noteMenu.x, top: noteMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {noteMenuMode === "main" ? (
            <div key="main" className="animate-menu-slide-right">
              {noteContextMenuItems.map((item, index) => (
                <button
                  key={item.action}
                  onClick={() => handleNoteMenuAction(item.action)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer ${
                    item.tone === "danger"
                      ? "text-red-400 hover:bg-danger-bg hover:text-red-500"
                      : "text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
                  } ${index > 0 ? "border-t border-paper-deep/20" : ""}`}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div key="move" className="animate-menu-slide-left">
              <button
                onClick={() => setNoteMenuMode("main")}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body text-ink-ghost hover:bg-paper-warm transition-colors cursor-pointer border-b border-paper-deep/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{t("common.back", { defaultValue: "返回" })}</span>
              </button>
              <button
                onClick={() => void handleMoveNote(noteMenuTarget.id, "")}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.uncategorized", { defaultValue: "未分类" })}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => void handleMoveNote(noteMenuTarget.id, cat)}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {categoryMenu && (
        <div
          className={`popup-menu fixed z-[9999] min-w-[140px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${categoryMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          data-hover-suppressed={categoryMenuHoverSuppressed ? "" : undefined}
          style={{ left: categoryMenu.x, top: categoryMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {categoryMenuConfirmDelete ? (
            <div key="category-confirm" className="animate-menu-slide-left">
              <div className="px-3 py-1.5 text-[11px] font-body text-ink-faint border-b border-paper-deep/20">
                {t("main.category.confirmDelete", {
                  category: categoryMenu.category,
                  defaultValue: "确认删除「{{category}}」？",
                })}
              </div>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void handleDeleteCategory(categoryMenu.category);
                  setCategoryMenuClosing(true);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer outline-none"
              >
                {t("main.category.confirmDeleteAction", { defaultValue: "确认删除" })}
              </button>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => switchCategoryMenuPanel(false)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer outline-none"
              >
                {t("common.cancel", { defaultValue: "取消" })}
              </button>
            </div>
          ) : (
            <div key="category-main" className="animate-menu-slide-right">
              <button
                onClick={() => {
                  setCategoryMenuClosing(true);
                  setRenamingCategory(categoryMenu.category);
                  setRenameCategoryValue(categoryMenu.category);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.rename", { defaultValue: "重命名" })}
              </button>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => switchCategoryMenuPanel(true)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer border-t border-paper-deep/20 outline-none"
              >
                {t("main.category.delete", { defaultValue: "删除分类" })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
