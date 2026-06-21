import chroma from "chroma-js";
import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parseMemoContent, serializeMemoDocument } from "../features/memo/document";
import { DEFAULT_TILE_COLOR, normalizeTileColor } from "../features/settings/tileColor";
import { MemoRenderer } from "./MemoRenderer";

export interface TileProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "color" | "content" | "title"
> {
  title?: string;
  content: string;
  color?: string;
  width?: number | string;
  rotation?: number;
  fontSize?: number;
  imageBaseDir?: string;
  noteFontFamily?: string;
  pendingImages?: Record<string, string>;
  onContentChange?: (content: string) => void;
  tileRef?: Ref<HTMLDivElement>;
}

const MARK_SIZE = 8;
const MARK_OFFSET = 6;

const cornerPaths = [
  {
    pos: { top: MARK_OFFSET, left: MARK_OFFSET },
    d: `M0,${MARK_SIZE} L0,0 L${MARK_SIZE},0`,
  },
  {
    pos: { top: MARK_OFFSET, right: MARK_OFFSET },
    d: `M0,0 L${MARK_SIZE},0 L${MARK_SIZE},${MARK_SIZE}`,
  },
  {
    pos: { bottom: MARK_OFFSET, left: MARK_OFFSET },
    d: `M0,0 L0,${MARK_SIZE} L${MARK_SIZE},${MARK_SIZE}`,
  },
  {
    pos: { bottom: MARK_OFFSET, right: MARK_OFFSET },
    d: `M${MARK_SIZE},0 L${MARK_SIZE},${MARK_SIZE} L0,${MARK_SIZE}`,
  },
];

function CornerMarks({ color }: { color: string }) {
  return (
    <>
      {cornerPaths.map((mark, index) => (
        <svg
          key={index}
          className="absolute pointer-events-none"
          data-tile-corner-mark="true"
          style={mark.pos as CSSProperties}
          width={MARK_SIZE}
          height={MARK_SIZE}
          viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
        >
          <path
            d={mark.d}
            stroke={color}
            strokeWidth="0.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </>
  );
}

export function Tile({
  title,
  content,
  color = DEFAULT_TILE_COLOR,
  width = 260,
  rotation = 0,
  fontSize = 14,
  imageBaseDir,
  noteFontFamily,
  pendingImages,
  onContentChange,
  tileRef,
  className = "",
  style,
  children,
  ...divProps
}: TileProps) {
  const { t } = useTranslation();
  const tileColor = normalizeTileColor(color);
  const { borderColor, cornerColor, titleColor, contentColor, emptyColor } = useMemo(() => {
    const isLightBg = chroma(tileColor).luminance() > 0.18;
    const mixTarget = isLightBg ? "#5c6a72" : "#d3c6aa";
    return {
      borderColor: chroma.mix(tileColor, mixTarget, 0.18).alpha(0.55).css(),
      cornerColor: chroma.mix(tileColor, mixTarget, 0.3).alpha(0.26).css(),
      titleColor: isLightBg
        ? chroma.mix("#8da101", tileColor, 0.12).css()
        : chroma.mix("#a7c080", "#d3c6aa", 0.16).css(),
      contentColor: chroma.mix(tileColor, mixTarget, 0.65).alpha(0.85).css(),
      emptyColor: chroma.mix(tileColor, mixTarget, 0.25).alpha(0.4).css(),
    };
  }, [tileColor]);
  const mergedStyle: CSSProperties = {
    width,
    backgroundColor: tileColor,
    borderColor,
    transition: "box-shadow 0.3s ease",
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
    ...style,
  };

  return (
    <div
      ref={tileRef}
      {...divProps}
      className={`app-surface-frame relative border overflow-hidden select-none shadow-[0_1px_8px_var(--color-shadow)] hover:shadow-[0_6px_24px_var(--color-shadow-deep)] ${className}`}
      style={mergedStyle}
    >
      <div
        className="px-4 pt-4 pb-4 h-full overflow-y-auto scrollbar-hidden"
        data-tile-content="true"
      >
        {title && (
          <div
            className="font-display tracking-wide mb-3 leading-snug"
            style={{ color: titleColor, fontSize: `${fontSize + 1}px` }}
          >
            {title}
          </div>
        )}
        {content ? (
          <div style={{ color: contentColor }}>
            <MemoRenderer
              content={serializeMemoDocument(parseMemoContent(content))}
              fontSize={fontSize}
              imageBaseDir={imageBaseDir}
              fontFamily={noteFontFamily}
              pendingImages={pendingImages}
              onChange={onContentChange}
              compact
            />
          </div>
        ) : (
          <div
            className="font-body text-center py-6"
            style={{ color: emptyColor, fontSize: `${fontSize}px` }}
          >
            {t("tile.empty", { defaultValue: "空" })}
          </div>
        )}
      </div>

      <CornerMarks color={cornerColor} />
      {children}
    </div>
  );
}
