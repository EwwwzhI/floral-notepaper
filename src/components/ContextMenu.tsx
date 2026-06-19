import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ExternalImageData } from "../features/images/pendingImages";
import { showToast } from "./Toast";

interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function readWebClipboardImageFile(): Promise<File | null> {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (!imageType) continue;
    const blob = await item.getType(imageType);
    return new File([blob], `clipboard.${imageType.split("/")[1] || "png"}`, {
      type: imageType,
    });
  }
  return null;
}

async function readTauriClipboardImageFile(): Promise<File> {
  const image = await readImage();
  try {
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
    if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
      throw new Error("剪贴板图片数据无效");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片转换画布");
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("剪贴板图片转 PNG 失败"))),
        "image/png",
      );
    });
    return new File([blob], "clipboard.png", { type: "image/png" });
  } finally {
    await image.close();
  }
}

function externalImageToFile(image: ExternalImageData): File {
  return new File([new Uint8Array(image.data)], image.fileName, { type: image.mimeType });
}

async function readClipboardImageFiles(): Promise<File[]> {
  try {
    const images = await invoke<ExternalImageData[]>("clipboard_read_image_files");
    if (images.length > 0) return images.map(externalImageToFile);
  } catch {
    // The Windows file-list format may not be present; continue with bitmap formats.
  }

  try {
    const image = await readWebClipboardImageFile();
    if (image) return [image];
  } catch {
    // WebView clipboard access may be unavailable; use the Tauri plugin below.
  }
  return [await readTauriClipboardImageFile()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const editableTargetRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null>(
    null,
  );

  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const isEditable =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;

      if (!isEditable) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      let selection = window.getSelection()?.toString() || "";
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        selection = target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
      }

      let x = event.clientX;
      let y = event.clientY;
      const menuWidth = 160;
      const menuHeight = 170;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 4;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 4;

      editableTargetRef.current = target;
      setMenuClosing(false);
      setMenu({ x, y, hasSelection: selection.length > 0 });
    }

    function handleClick() {
      setMenuClosing(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuClosing(true);
    }

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!menuClosing || !menu) return;
    const timer = window.setTimeout(() => {
      setMenu(null);
      setMenuClosing(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [menuClosing, menu]);

  const dismissMenu = useCallback(() => {
    setMenuClosing(true);
  }, []);

  const runCommand = async (command: string) => {
    const target = editableTargetRef.current;

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      const value = target.value;
      const selected = value.slice(start, end);
      const before = value.slice(0, start);
      const after = value.slice(end);

      target.focus();

      const nativeSetter = target instanceof HTMLTextAreaElement ? textareaSetter : inputSetter;
      const setValue = (newValue: string, cursorPos: number) => {
        nativeSetter?.call(target, newValue);
        target.selectionStart = target.selectionEnd = cursorPos;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      };

      switch (command) {
        case "copy":
          if (selected) await writeText(selected);
          break;
        case "cut":
          if (selected) {
            await writeText(selected);
            setValue(before + after, start);
          }
          break;
        case "paste": {
          const memoEditor = target.closest('[data-memo-editor="true"]') as
            | (HTMLElement & { floralPasteImages?: (files: File[]) => void })
            | null;
          let imageError: unknown;
          if (memoEditor?.floralPasteImages) {
            try {
              const images = await readClipboardImageFiles();
              memoEditor.floralPasteImages(images);
              break;
            } catch (error) {
              imageError = error;
            }
          }
          try {
            const text = await readText();
            if (text) {
              setValue(before + text + after, start + text.length);
              break;
            }
          } catch (error) {
            if (!imageError) imageError = error;
          }
          if (memoEditor && imageError) {
            showToast(`粘贴图片失败：${errorMessage(imageError)}`);
          }
          break;
        }
        case "selectAll":
          target.select();
          break;
      }
    } else {
      target?.focus();
      document.execCommand(command);
    }

    dismissMenu();
  };

  const items = useMemo(
    () =>
      menu
        ? [
            {
              label: t("contextMenu.edit.cut", { defaultValue: "剪切" }),
              shortcut: "Ctrl+X",
              action: () => runCommand("cut"),
              disabled: !menu.hasSelection,
            },
            {
              label: t("contextMenu.edit.copy", { defaultValue: "复制" }),
              shortcut: "Ctrl+C",
              action: () => runCommand("copy"),
              disabled: !menu.hasSelection,
            },
            {
              label: t("contextMenu.edit.paste", { defaultValue: "粘贴" }),
              shortcut: "Ctrl+V",
              action: () => runCommand("paste"),
              disabled: false,
            },
            { separator: true as const },
            {
              label: t("contextMenu.edit.selectAll", { defaultValue: "全选" }),
              shortcut: "Ctrl+A",
              action: () => runCommand("selectAll"),
              disabled: false,
            },
          ]
        : [],
    [menu, runCommand, t],
  );

  return (
    <>
      {children}
      {menu && (
        <div
          ref={menuRef}
          className={`fixed z-[9999] min-w-[152px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${menuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{
            left: menu.x,
            top: menu.y,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {items.map((item, index) =>
            "separator" in item ? (
              <div key={index} className="mx-2 my-1 h-px bg-paper-deep/40" />
            ) : (
              <button
                key={item.label}
                onClick={() => void item.action()}
                disabled={item.disabled}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer disabled:text-ink-ghost/40 disabled:cursor-default disabled:hover:bg-transparent text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-[10px] text-ink-ghost/60 font-mono ml-6">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
