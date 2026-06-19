import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { serializeMemoDocument } from "../features/memo/document";
import { MemoRenderer } from "./MemoRenderer";

describe("MemoRenderer", () => {
  test("renders structured text and interactive-looking todos without exposing storage JSON", () => {
    const content = serializeMemoDocument({
      version: 1,
      blocks: [
        {
          id: "text",
          type: "text",
          text: "周末采购",
          style: "heading",
          format: { bold: true, underline: true },
          link: "https://example.com/weekend",
        },
        { id: "todo", type: "todo", text: "买花", checked: true },
      ],
    });

    const markup = renderToStaticMarkup(<MemoRenderer content={content} />);

    expect(markup).toContain("周末采购");
    expect(markup).toContain("买花");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("font-weight:700");
    expect(markup).toContain("text-decoration:underline");
    expect(markup).toContain('href="https://example.com/weekend"');
    expect(markup).not.toContain("FLORAL_MEMO_V1");
  });

  test("renders formatting only around the configured text range", () => {
    const content = serializeMemoDocument({
      version: 1,
      blocks: [
        {
          id: "text",
          type: "text",
          text: "更新文档手册",
          style: "body",
          formats: [{ start: 2, end: 4, format: { bold: true, underline: true } }],
        },
      ],
    });

    const markup = renderToStaticMarkup(<MemoRenderer content={content} />);

    expect(markup).toContain("更新");
    expect(markup).toContain('style="font-weight:700;text-decoration:underline"');
    expect(markup).toContain(">文档</span>");
    expect(markup).toContain("手册");
  });

  test("automatically turns plain URLs and email addresses into clickable links", () => {
    const content = serializeMemoDocument({
      version: 1,
      blocks: [
        {
          id: "text",
          type: "text",
          text: "查看 https://example.com/docs 或联系 hi@example.com",
          style: "body",
        },
      ],
    });

    const markup = renderToStaticMarkup(<MemoRenderer content={content} />);

    expect(markup).toContain('href="https://example.com/docs"');
    expect(markup).toContain('href="mailto:hi@example.com"');
  });
});
