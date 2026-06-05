interface ParsedBlock {
  text: string;
  startLine: number; // inclusive
  endLine: number; // exclusive
}

const MIRROR_STYLE_PROPERTIES = [
  "font",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "wordBreak",
  "overflowWrap",
  "wordWrap",
  "tabSize",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "border",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
] as const;

const MIRROR_BUILD_YIELD_INTERVAL = 500;
const MARKER_MEASURE_YIELD_INTERVAL = 64;

function yieldToPendingWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Parse markdown into non-empty logical blocks with line boundaries. */
function parseBlocks(text: string): ParsedBlock[] {
  const lines = text.split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;

  const push = (start: number, end: number) => {
    blocks.push({ text: lines.slice(start, end).join("\n"), startLine: start, endLine: end });
  };

  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }

    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block
    const fenceMatch = trimmed.match(/^(```|~~~)/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) i++;
      if (i < lines.length) i++;
      push(start, i);
      continue;
    }

    // Display math block
    if (trimmed === "$$") {
      const start = i;
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") i++;
      if (i < lines.length) i++;
      push(start, i);
      continue;
    }

    // Heading / HR
    if (/^#{1,6}\s/.test(line) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      push(i, i + 1);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const start = i;
      while (i < lines.length && lines[i].startsWith(">")) i++;
      push(start, i);
      continue;
    }

    // Table
    if (/^\s*\|/.test(line)) {
      const start = i;
      while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
      push(start, i);
      continue;
    }

    // List
    if (/^(\s*[-*+]\s|\s*\d+[.)]\s)/.test(line)) {
      const start = i;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") {
          const next = i + 1;
          if (next < lines.length && /^(\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[next])) {
            i++;
            continue;
          }
          break;
        }
        if (/^(#{1,6}\s|```|~~~|>)/.test(l) || l.trim() === "$$") break;
        i++;
      }
      push(start, i);
      continue;
    }

    // Paragraph
    const start = i;
    while (i < lines.length && lines[i].trim() !== "") {
      const l = lines[i];
      if (/^(#{1,6}\s|```|~~~|>)/.test(l)) break;
      if (l.trim() === "$$") break;
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l.trim())) break;
      i++;
    }
    if (i > start) push(start, i);
  }

  return blocks;
}

/**
 * Measure the textarea scrollTop offset where each block begins.
 * 使用 textarea 的 scrollTop 坐标测量每个块的起点。
 *
 * Uses one hidden mirror with block-start markers, avoiding repeated growing-prefix
 * textarea measurements for long documents.
 * 使用一个带块起点标记的隐藏镜像，避免长文档反复测量不断增长的 textarea 前缀。
 *
 * Pass an AbortSignal to cancel in-progress measurement; aborted callers may receive
 * a partial result and are expected to discard it.
 * 传入 AbortSignal 可取消测量；被取消的调用方可能收到部分结果，并应丢弃它。
 */
export async function measureBlockOffsets(
  content: string,
  sourceTextarea: HTMLTextAreaElement,
  signal?: AbortSignal,
): Promise<number[]> {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) return [];

  const style = getComputedStyle(sourceTextarea);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const measure = document.createElement("div");
  const width =
    style.width && style.width !== "auto" ? style.width : `${sourceTextarea.clientWidth}px`;
  const markers: HTMLElement[] = [];

  measure.style.cssText = `
    position: fixed; top: -9999px; left: -9999px; visibility: hidden;
    width: ${width};
    height: auto;
    margin: 0;
    box-sizing: ${style.boxSizing};
    white-space: pre-wrap;
    overflow: hidden;
    pointer-events: none;
    contain: layout style;
    ${MIRROR_STYLE_PROPERTIES.map((property) => {
      const cssName = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return `${cssName}: ${style[property]};`;
    }).join("\n    ")}
  `;

  const markerLines = new Map<number, number>();
  blocks.forEach((block, index) => markerLines.set(block.startLine, index));

  const lines = content.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const markerIndex = markerLines.get(lineIndex);
    if (markerIndex !== undefined) {
      const marker = document.createElement("span");
      marker.style.cssText =
        "display: inline-block; width: 0; height: 0; overflow: hidden; line-height: 0; font-size: 0; vertical-align: top;";
      markers[markerIndex] = marker;
      measure.appendChild(marker);
    }
    measure.appendChild(document.createTextNode(line));
    if (lineIndex < lines.length - 1) measure.appendChild(document.createTextNode("\n"));

    if ((lineIndex + 1) % MIRROR_BUILD_YIELD_INTERVAL === 0) {
      // Let huge mirror construction observe cancellation before attachment.\n    // 构建超大镜像时也要让出主线程，这样挂载前就能响应取消。
      // 让超大镜像构建在挂载前有机会观察取消信号。
      await yieldToPendingWork();
      if (signal?.aborted) return [];
    }
  }

  if (signal?.aborted) return [];

  document.body.appendChild(measure);

  const offsets: number[] = [];
  try {
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index];
      if (signal?.aborted) break;
      offsets.push(Math.max(0, marker.offsetTop - paddingTop));
      if (signal?.aborted) break;

      if ((index + 1) % MARKER_MEASURE_YIELD_INTERVAL === 0) {
        // Long marker reads yield so AbortSignal changes can be observed.\n      // 长文档读取标记位置时分批让出主线程，才能及时发现 AbortSignal 已变化。
        // 长时间读取标记时主动让出执行权，以便观察 AbortSignal 的变化。
        await yieldToPendingWork();
      }
    }
  } finally {
    document.body.removeChild(measure);
  }

  return offsets;
}

/** Find which block index occupies the given textarea scrollTop. */
export function blockIndexAtOffset(offsets: number[], scrollTop: number): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (offsets[i] <= scrollTop) return i;
  }
  return 0;
}

/**
 * Add data-block-index attributes to block-level children
 * of the MarkdownPreview root element (.font-body).
 * Indices match the non-empty block indices from parseBlocks.
 */
export function tagPreviewBlocks(container: HTMLElement): void {
  const root = container.querySelector<HTMLElement>(".font-body");
  if (!root) return;
  let index = 0;
  for (const child of root.children) {
    if (child instanceof HTMLElement) {
      child.setAttribute("data-block-index", String(index++));
    }
  }
}
