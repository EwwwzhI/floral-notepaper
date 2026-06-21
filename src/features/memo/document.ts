export const MEMO_CONTENT_PREFIX = "FLORAL_MEMO_V1\n";

export type MemoTextStyle = "body" | "heading";
export type MemoImageAlignment = "left" | "center" | "right";

export interface MemoTextFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  link?: string;
}

export interface MemoFormatRange {
  start: number;
  end: number;
  format: MemoTextFormat;
}

export interface MemoTextBlock {
  id: string;
  type: "text";
  text: string;
  style: MemoTextStyle;
  format?: MemoTextFormat;
  formats?: MemoFormatRange[];
  link?: string;
}

export interface MemoTodoBlock {
  id: string;
  type: "todo";
  text: string;
  checked: boolean;
  format?: MemoTextFormat;
  formats?: MemoFormatRange[];
  link?: string;
}

export interface MemoImageBlock {
  id: string;
  type: "image";
  src: string;
  alt?: string;
  align?: MemoImageAlignment;
}

export type MemoBlock = MemoTextBlock | MemoTodoBlock | MemoImageBlock;

export interface MemoDocument {
  version: 1;
  blocks: MemoBlock[];
}

const LEGACY_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const LEGACY_LINK_RE = /^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;
const LEGACY_TODO_RE = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/;
const LEGACY_HEADING_RE = /^\s*#{1,6}\s+(.+)$/;
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const MEMO_LINK_CANDIDATE_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'，。！？；：、（）【】]+|[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}|(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s<>"'，。！？；：、（）【】]*)?/gi;
const TRAILING_LINK_PUNCTUATION_RE = /[.,!?;:，。！？；：、)\]}]+$/;
let blockSequence = 0;

export interface MemoDetectedLink {
  start: number;
  end: number;
  text: string;
  url: string;
}

export function createMemoBlockId(): string {
  blockSequence += 1;
  return `memo-${Date.now().toString(36)}-${blockSequence.toString(36)}`;
}

export function createEmptyMemoDocument(): MemoDocument {
  return {
    version: 1,
    blocks: [{ id: createMemoBlockId(), type: "text", text: "", style: "body" }],
  };
}

export function serializeMemoDocument(document: MemoDocument): string {
  return `${MEMO_CONTENT_PREFIX}${JSON.stringify(normalizeMemoDocument(document))}`;
}

export function createEmptyMemoContent(): string {
  return serializeMemoDocument(createEmptyMemoDocument());
}

export function isMemoContent(content: string): boolean {
  if (!content.startsWith(MEMO_CONTENT_PREFIX)) return false;
  try {
    const parsed = JSON.parse(content.slice(MEMO_CONTENT_PREFIX.length)) as unknown;
    return isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.blocks);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeMemoLinkUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    candidate = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
      ? `mailto:${candidate}`
      : `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? candidate : null;
  } catch {
    return null;
  }
}

export function findMemoTextLinks(value: string): MemoDetectedLink[] {
  const links: MemoDetectedLink[] = [];
  MEMO_LINK_CANDIDATE_RE.lastIndex = 0;

  for (const match of value.matchAll(MEMO_LINK_CANDIDATE_RE)) {
    const raw = match[0];
    const text = raw.replace(TRAILING_LINK_PUNCTUATION_RE, "");
    if (!text) continue;
    const url = normalizeMemoLinkUrl(text);
    if (!url) continue;
    const start = match.index ?? 0;
    links.push({ start, end: start + text.length, text, url });
  }

  return links;
}

export function memoLinkFromPastedText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  const links = findMemoTextLinks(trimmed);
  return links.length === 1 && links[0].start === 0 && links[0].end === trimmed.length
    ? links[0].url
    : null;
}

function parseTextFormat(value: unknown): MemoTextFormat | undefined {
  if (!isRecord(value)) return undefined;
  const format: MemoTextFormat = {
    bold: value.bold === true || undefined,
    italic: value.italic === true || undefined,
    underline: value.underline === true || undefined,
    link:
      typeof value.link === "string" ? (normalizeMemoLinkUrl(value.link) ?? undefined) : undefined,
  };
  return format.bold || format.italic || format.underline || format.link ? format : undefined;
}

function parseFormatRanges(value: unknown, textLength: number): MemoFormatRange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ranges = value
    .map((item): MemoFormatRange | null => {
      if (!isRecord(item)) return null;
      const start = typeof item.start === "number" ? Math.max(0, Math.floor(item.start)) : 0;
      const end =
        typeof item.end === "number" ? Math.min(textLength, Math.floor(item.end)) : textLength;
      const format = parseTextFormat(item.format);
      return format && end > start ? { start, end, format } : null;
    })
    .filter((range): range is MemoFormatRange => range !== null);
  return ranges.length > 0 ? ranges : undefined;
}

function parseBlock(value: unknown): MemoBlock | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const id = typeof value.id === "string" && value.id ? value.id : createMemoBlockId();

  if (value.type === "text" && typeof value.text === "string") {
    return {
      id,
      type: "text",
      text: value.text,
      style: value.style === "heading" ? "heading" : "body",
      format: parseTextFormat(value.format),
      formats: parseFormatRanges(value.formats, value.text.length),
      link:
        typeof value.link === "string"
          ? (normalizeMemoLinkUrl(value.link) ?? undefined)
          : undefined,
    };
  }

  if (value.type === "todo" && typeof value.text === "string") {
    return {
      id,
      type: "todo",
      text: value.text,
      checked: value.checked === true,
      format: parseTextFormat(value.format),
      formats: parseFormatRanges(value.formats, value.text.length),
      link:
        typeof value.link === "string"
          ? (normalizeMemoLinkUrl(value.link) ?? undefined)
          : undefined,
    };
  }

  if (value.type === "image" && typeof value.src === "string" && value.src) {
    return {
      id,
      type: "image",
      src: value.src,
      alt: typeof value.alt === "string" ? value.alt : undefined,
      align:
        value.align === "left" || value.align === "right" || value.align === "center"
          ? value.align
          : undefined,
    };
  }

  return null;
}

type MemoFormattedBlock = MemoTextBlock | MemoTodoBlock;

function sameTextFormat(left: MemoTextFormat, right: MemoTextFormat): boolean {
  return (
    Boolean(left.bold) === Boolean(right.bold) &&
    Boolean(left.italic) === Boolean(right.italic) &&
    Boolean(left.underline) === Boolean(right.underline) &&
    left.link === right.link
  );
}

function effectiveFormats(block: MemoFormattedBlock): MemoTextFormat[] {
  const formats = Array.from({ length: block.text.length }, () => ({ ...block.format }));
  for (const range of block.formats ?? []) {
    const start = Math.max(0, Math.min(block.text.length, range.start));
    const end = Math.max(start, Math.min(block.text.length, range.end));
    for (let index = start; index < end; index += 1) {
      formats[index] = { ...formats[index], ...range.format };
    }
  }
  return formats;
}

function compressFormats(formats: MemoTextFormat[]): MemoFormatRange[] | undefined {
  const ranges: MemoFormatRange[] = [];
  let start = 0;
  while (start < formats.length) {
    const format = formats[start];
    let end = start + 1;
    while (end < formats.length && sameTextFormat(formats[end], format)) end += 1;
    if (format.bold || format.italic || format.underline || format.link) {
      ranges.push({ start, end, format });
    }
    start = end;
  }
  return ranges.length > 0 ? ranges : undefined;
}

export interface MemoFormattedSegment {
  start: number;
  end: number;
  text: string;
  format: MemoTextFormat;
}

export function memoFormattedSegments(block: MemoFormattedBlock): MemoFormattedSegment[] {
  if (!block.text) return [];
  const formats = effectiveFormats(block);
  const segments: MemoFormattedSegment[] = [];
  let start = 0;
  while (start < block.text.length) {
    const format = formats[start];
    let end = start + 1;
    while (end < block.text.length && sameTextFormat(formats[end], format)) end += 1;
    segments.push({ start, end, text: block.text.slice(start, end), format });
    start = end;
  }
  return segments;
}

export function toggleMemoTextFormat(
  block: MemoFormattedBlock,
  selectionStart: number,
  selectionEnd: number,
  key: keyof MemoTextFormat,
): MemoFormattedBlock {
  const formats = effectiveFormats(block);
  const start = Math.max(0, Math.min(block.text.length, selectionStart));
  const requestedEnd = Math.max(0, Math.min(block.text.length, selectionEnd));
  const hasSelection = requestedEnd > start;
  const rangeStart = hasSelection ? start : 0;
  const end = hasSelection ? requestedEnd : block.text.length;
  if (end <= rangeStart) return block;

  const enable = !formats.slice(rangeStart, end).every((format) => Boolean(format[key]));
  for (let index = rangeStart; index < end; index += 1) {
    formats[index] = { ...formats[index], [key]: enable || undefined };
  }
  return { ...block, format: undefined, formats: compressFormats(formats) };
}

export function updateMemoBlockText(
  block: MemoFormattedBlock,
  nextText: string,
): MemoFormattedBlock {
  if (nextText === block.text) return block;
  const previousFormats = effectiveFormats(block);
  let prefix = 0;
  while (
    prefix < block.text.length &&
    prefix < nextText.length &&
    block.text[prefix] === nextText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < block.text.length - prefix &&
    suffix < nextText.length - prefix &&
    block.text[block.text.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const insertedLength = nextText.length - prefix - suffix;
  const inheritedFormat = previousFormats[Math.max(0, prefix - 1)] ?? previousFormats[prefix] ?? {};
  const nextFormats = [
    ...previousFormats.slice(0, prefix),
    ...Array.from({ length: insertedLength }, () => ({ ...inheritedFormat })),
    ...previousFormats.slice(block.text.length - suffix),
  ];
  return {
    ...block,
    text: nextText,
    format: undefined,
    formats: compressFormats(nextFormats),
  };
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/, "");
}

export function legacyContentToMemoDocument(content: string): MemoDocument {
  if (!content.trim()) return createEmptyMemoDocument();

  const blocks: MemoBlock[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    const text = textLines.join("\n").replace(/\n{3,}/g, "\n\n");
    if (text.trim()) {
      blocks.push({ id: createMemoBlockId(), type: "text", text, style: "body" });
    }
    textLines = [];
  };

  for (const line of content.split(/\r?\n/)) {
    const image = line.match(LEGACY_IMAGE_RE);
    if (image) {
      flushText();
      blocks.push({
        id: createMemoBlockId(),
        type: "image",
        src: image[2],
        alt: image[1] || undefined,
      });
      continue;
    }

    const todo = line.match(LEGACY_TODO_RE);
    if (todo) {
      flushText();
      blocks.push({
        id: createMemoBlockId(),
        type: "todo",
        checked: todo[1].toLowerCase() === "x",
        text: stripInlineMarkdown(todo[2]),
      });
      continue;
    }

    const link = line.match(LEGACY_LINK_RE);
    if (link) {
      flushText();
      const url = normalizeMemoLinkUrl(link[2]);
      blocks.push({
        id: createMemoBlockId(),
        type: "text",
        text: stripInlineMarkdown(link[1]),
        style: "body",
        link: url ?? undefined,
      });
      continue;
    }

    const heading = line.match(LEGACY_HEADING_RE);
    if (heading) {
      flushText();
      blocks.push({
        id: createMemoBlockId(),
        type: "text",
        text: stripInlineMarkdown(heading[1]),
        style: "heading",
      });
      continue;
    }

    textLines.push(stripInlineMarkdown(line));
  }

  flushText();
  return normalizeMemoDocument({ version: 1, blocks });
}

export function normalizeMemoDocument(document: MemoDocument): MemoDocument {
  const blockIds = new Set<string>();
  const blocks = document.blocks
    .filter((block) => {
      return (
        (block.type === "text" && typeof block.text === "string") ||
        (block.type === "todo" && typeof block.text === "string") ||
        (block.type === "image" && Boolean(block.src))
      );
    })
    .map((block) => {
      const id = block.id && !blockIds.has(block.id) ? block.id : createMemoBlockId();
      blockIds.add(id);
      if (block.type === "image") return { ...block, id };
      return {
        ...block,
        id,
        link: normalizeMemoLinkUrl(block.link) ?? undefined,
        formats: parseFormatRanges(block.formats, block.text.length),
      };
    });
  return blocks.length > 0 ? { version: 1, blocks } : createEmptyMemoDocument();
}

export function parseMemoContent(content: string): MemoDocument {
  if (!isMemoContent(content)) return legacyContentToMemoDocument(content);

  try {
    const parsed = JSON.parse(content.slice(MEMO_CONTENT_PREFIX.length)) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.blocks)) {
      return createEmptyMemoDocument();
    }
    return normalizeMemoDocument({
      version: 1,
      blocks: parsed.blocks.map(parseBlock).filter((block): block is MemoBlock => block !== null),
    });
  } catch {
    return createEmptyMemoDocument();
  }
}

export function memoPlainText(content: string): string {
  return parseMemoContent(content)
    .blocks.flatMap((block) => {
      if (block.type === "text" || block.type === "todo") return block.text;
      return block.alt ? `[${block.alt}]` : [];
    })
    .join("\n")
    .trim();
}

export function memoHasContent(content: string): boolean {
  return parseMemoContent(content).blocks.some((block) => {
    return block.type === "image" || block.text.trim().length > 0;
  });
}

export function memoBlockCount(content: string): number {
  return parseMemoContent(content).blocks.filter((block) => {
    return block.type === "image" || block.text.trim().length > 0;
  }).length;
}

export function appendMemoBlocks(content: string, blocks: MemoBlock[]): string {
  const document = parseMemoContent(content);
  const existing =
    document.blocks.length === 1 && document.blocks[0].type === "text" && !document.blocks[0].text
      ? []
      : document.blocks;
  return serializeMemoDocument({ version: 1, blocks: [...existing, ...blocks] });
}
