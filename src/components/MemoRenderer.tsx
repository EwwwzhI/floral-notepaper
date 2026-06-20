import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  findMemoTextLinks,
  memoFormattedSegments,
  memoHasContent,
  normalizeMemoLinkUrl,
  parseMemoContent,
  serializeMemoDocument,
  type MemoTextBlock,
  type MemoTodoBlock,
} from "../features/memo/document";

interface MemoRendererProps {
  content: string;
  fontSize?: number;
  fontFamily?: string;
  imageBaseDir?: string;
  pendingImages?: Record<string, string>;
  onChange?: (content: string) => void;
  compact?: boolean;
}

function resolveImageSrc(
  src: string,
  imageBaseDir: string | undefined,
  pendingImages: Record<string, string> | undefined,
) {
  if (src.startsWith("pending-image://")) {
    return pendingImages?.[src.slice("pending-image://".length)] ?? "";
  }
  if (src.startsWith("images/") && imageBaseDir) {
    return convertFileSrc(`${imageBaseDir}/${src}`);
  }
  return src;
}

function openMemoLink(event: MouseEvent<HTMLAnchorElement>, value: string) {
  event.preventDefault();
  event.stopPropagation();
  const url = normalizeMemoLinkUrl(value);
  if (url) void openUrl(url);
}

function LinkedMemoText({ text }: { text: string }) {
  const links = findMemoTextLinks(text);
  if (links.length === 0) return text;

  const parts: ReactNode[] = [];
  let offset = 0;
  for (const link of links) {
    if (link.start > offset) parts.push(text.slice(offset, link.start));
    parts.push(
      <a
        key={`${link.start}-${link.url}`}
        href={link.url}
        className="memo-renderer-link"
        title={link.url}
        onClick={(event) => openMemoLink(event, link.url)}
      >
        {link.text}
      </a>,
    );
    offset = link.end;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

function FormattedMemoText({ block }: { block: MemoTextBlock | MemoTodoBlock }) {
  return memoFormattedSegments(block).map((segment) => {
    const content = segment.format.link ? (
      <a
        href={segment.format.link}
        className="memo-renderer-link"
        title={segment.format.link}
        onClick={(event) => openMemoLink(event, segment.format.link!)}
      >
        {segment.text}
      </a>
    ) : block.link ? (
      segment.text
    ) : (
      <LinkedMemoText text={segment.text} />
    );
    return (
      <span
        key={`${segment.start}-${segment.end}`}
        style={{
          fontWeight: segment.format.bold ? 700 : undefined,
          fontStyle: segment.format.italic ? "italic" : undefined,
          textDecoration: segment.format.underline ? "underline" : undefined,
        }}
      >
        {content}
      </span>
    );
  });
}

export function MemoRenderer({
  content,
  fontSize = 14,
  fontFamily,
  imageBaseDir,
  pendingImages,
  onChange,
  compact = false,
}: MemoRendererProps) {
  const { t } = useTranslation();
  const document = useMemo(() => parseMemoContent(content), [content]);

  if (!memoHasContent(content)) {
    return <div className="memo-renderer-empty">{t("tile.empty", { defaultValue: "空" })}</div>;
  }

  return (
    <div
      className={`memo-renderer ${compact ? "memo-renderer-compact" : ""}`}
      style={{ fontSize: `${fontSize}px`, fontFamily }}
    >
      {document.blocks.map((block) => {
        if (block.type === "image") {
          const src = resolveImageSrc(block.src, imageBaseDir, pendingImages);
          return src ? (
            <figure
              key={block.id}
              className={`memo-renderer-image-wrap is-${block.align ?? "center"}`}
            >
              <img
                src={src}
                alt={block.alt ?? ""}
                className="memo-renderer-image"
                draggable={false}
              />
            </figure>
          ) : null;
        }

        if (block.type === "todo") {
          return (
            <div key={block.id} className="memo-renderer-todo">
              <input
                type="checkbox"
                checked={block.checked}
                disabled={!onChange}
                onChange={() => {
                  if (!onChange) return;
                  onChange(
                    serializeMemoDocument({
                      ...document,
                      blocks: document.blocks.map((item) =>
                        item.id === block.id
                          ? ({
                              ...(item as MemoTodoBlock),
                              checked: !(item as MemoTodoBlock).checked,
                            } satisfies MemoTodoBlock)
                          : item,
                      ),
                    }),
                  );
                }}
              />
              {block.link ? (
                <a
                  href={block.link}
                  className="memo-renderer-link"
                  title={block.link}
                  onClick={(event) => openMemoLink(event, block.link!)}
                >
                  <span className={block.checked ? "is-checked" : ""}>
                    <FormattedMemoText block={block} />
                  </span>
                </a>
              ) : (
                <span className={block.checked ? "is-checked" : ""}>
                  <FormattedMemoText block={block} />
                </span>
              )}
            </div>
          );
        }

        const text = (
          <div className={`memo-renderer-text ${block.style === "heading" ? "is-heading" : ""}`}>
            <FormattedMemoText block={block} />
          </div>
        );
        return block.link ? (
          <a
            key={block.id}
            href={block.link}
            className="memo-renderer-link memo-renderer-block-link"
            title={block.link}
            onClick={(event) => openMemoLink(event, block.link!)}
          >
            {text}
          </a>
        ) : (
          <div key={block.id}>{text}</div>
        );
      })}
    </div>
  );
}
