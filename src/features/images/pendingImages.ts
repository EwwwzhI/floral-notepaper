export interface PendingImage {
  tempId: string;
  fileName: string;
  extension: string;
  mimeType: string;
  data: number[];
  objectUrl: string;
}

export interface ExternalImageData {
  fileName: string;
  extension: string;
  mimeType: string;
  data: number[];
}

export const PENDING_IMAGE_PREFIX = "pending-image://";

export function pendingImageMarkdown(tempId: string): string {
  return `![](${PENDING_IMAGE_PREFIX}${tempId})`;
}

export function extractPendingImageIds(content: string): string[] {
  const ids = new Set<string>();
  const pattern = /pending-image:\/\/([A-Za-z0-9_-]+)/g;
  for (const match of content.matchAll(pattern)) {
    ids.add(match[1]);
  }
  return [...ids];
}

export function replacePendingImageRefs(
  content: string,
  replacements: Record<string, string>,
): string {
  return content.replace(/pending-image:\/\/([A-Za-z0-9_-]+)/g, (match, id: string) => {
    return replacements[id] ?? match;
  });
}

export function pendingImageObjectUrls(
  images: Record<string, PendingImage>,
): Record<string, string> {
  return Object.fromEntries(Object.values(images).map((image) => [image.tempId, image.objectUrl]));
}

export function revokePendingImages(images: Iterable<PendingImage>): void {
  for (const image of images) {
    URL.revokeObjectURL(image.objectUrl);
  }
}

export async function createPendingImageFromFile(file: File): Promise<PendingImage | null> {
  const extension = extensionFromMime(file.type);
  if (!extension) return null;
  const buffer = await file.arrayBuffer();
  return createPendingImage({
    fileName: file.name || `image.${extension}`,
    extension,
    mimeType: file.type,
    data: Array.from(new Uint8Array(buffer)),
  });
}

export function createPendingImage(image: ExternalImageData): PendingImage {
  const tempId = crypto.randomUUID();
  const blob = new Blob([new Uint8Array(image.data)], { type: image.mimeType });
  return {
    tempId,
    fileName: image.fileName,
    extension: image.extension,
    mimeType: image.mimeType,
    data: image.data,
    objectUrl: URL.createObjectURL(blob),
  };
}

export function extensionFromMime(mimeType: string): string | null {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return null;
  }
}
