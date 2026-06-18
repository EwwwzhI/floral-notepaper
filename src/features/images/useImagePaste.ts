import { useCallback, useRef } from "react";
import type { TFunction } from "i18next";
import {
  createPendingImageFromFile,
  pendingImageMarkdown,
  type PendingImage,
} from "./pendingImages";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

interface UseImagePasteOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setContent: (content: string) => void;
  markDirty: () => void;
  onAddPendingImages: (images: PendingImage[]) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
  t?: TFunction;
}

async function processImageFile(file: File, t?: TFunction): Promise<PendingImage | null> {
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error(
      t?.("errors.imageTooLarge", { defaultValue: "图片文件过大（上限 20 MB）" }) ??
        "图片文件过大（上限 20 MB）",
    );
  }

  return createPendingImageFromFile(file);
}

export function insertTextAtCursor(
  textarea: HTMLTextAreaElement,
  setContent: (value: string) => void,
  text: string,
) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  const insertion = (needsLeadingNewline ? "\n" : "") + text + "\n";

  textarea.focus();
  document.execCommand("insertText", false, insertion);
  setContent(textarea.value);
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i];
    if (item.kind === "file" && item.type in MIME_TO_EXT) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function useImagePaste({
  textareaRef,
  setContent,
  markDirty,
  onAddPendingImages,
  disabled,
  onError,
  t,
}: UseImagePasteOptions) {
  const processingRef = useRef(false);

  const processFiles = useCallback(
    async (files: File[]) => {
      if (processingRef.current || files.length === 0) return;
      processingRef.current = true;

      try {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const pendingImages: PendingImage[] = [];
        const markdownLines: string[] = [];
        for (const file of files) {
          const pendingImage = await processImageFile(file, t);
          if (pendingImage) {
            pendingImages.push(pendingImage);
            markdownLines.push(pendingImageMarkdown(pendingImage.tempId));
          }
        }

        if (markdownLines.length > 0) {
          onAddPendingImages(pendingImages);
          insertTextAtCursor(textarea, setContent, markdownLines.join("\n"));
          markDirty();
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : (t?.("errors.imagePasteFailed", { defaultValue: "图片粘贴失败" }) ?? "图片粘贴失败");
        onError?.(message);
      } finally {
        processingRef.current = false;
      }
    },
    [textareaRef, setContent, markDirty, onAddPendingImages, onError, t],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const files = getImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void processFiles(files);
    },
    [disabled, processFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const files = getImageFiles(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      void processFiles(files);
    },
    [disabled, processFiles],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const hasImage = Array.from(event.dataTransfer.items).some(
        (item) => item.kind === "file" && item.type in MIME_TO_EXT,
      );
      if (hasImage) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [disabled],
  );

  return { handlePaste, handleDrop, handleDragOver };
}
