import type { TFunction } from "i18next";
import { formatTodoSelection } from "./taskList";

export type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "heading1"
  | "heading2"
  | "heading3"
  | "hr"
  | "ul"
  | "ol"
  | "todo"
  | "todoToggle"
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath";

export type NoSelectionScope = "placeholder" | "all" | "currentLine";

export interface FormatMarkdownInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  action: FormatAction;
  translate: TFunction;
  noSelectionScope?: NoSelectionScope;
}

export interface FormatMarkdownResult {
  text: string;
  cursorStart: number;
  cursorEnd: number;
}

function normalizeRange(input: FormatMarkdownInput) {
  const hasSelection = input.selectionStart !== input.selectionEnd;
  if (hasSelection) {
    return { start: input.selectionStart, end: input.selectionEnd };
  }

  if (input.noSelectionScope === "currentLine") {
    const lineStart = input.value.lastIndexOf("\n", input.selectionStart - 1) + 1;
    const lineEndIndex = input.value.indexOf("\n", input.selectionEnd);
    const lineEnd = lineEndIndex === -1 ? input.value.length : lineEndIndex;
    return { start: lineStart, end: lineEnd };
  }

  if (input.noSelectionScope !== "all" || input.value.length === 0) {
    return { start: input.selectionStart, end: input.selectionEnd };
  }

  if (input.action === "heading" || input.action.startsWith("heading")) {
    const lineEnd = input.value.indexOf("\n");
    return { start: 0, end: lineEnd === -1 ? input.value.length : lineEnd };
  }

  return { start: 0, end: input.value.length };
}

function stripListPrefix(line: string): string {
  return line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "");
}

function formatLinePrefixSelection(
  selected: string,
  prefixForIndex: (index: number) => string,
  fallback: string,
): string {
  const source = selected || fallback;
  return source
    .split("\n")
    .map((line, index) => {
      if (!line.trim()) return line;
      return `${prefixForIndex(index)}${stripListPrefix(line)}`;
    })
    .join("\n");
}

function setHeading(
  value: string,
  start: number,
  end: number,
  level: number,
): FormatMarkdownResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const body = line.replace(/^#{1,6}\s+/, "");
  const replacement = `${"#".repeat(level)} ${body}`;
  const text = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
  const cursorStart = lineStart + level + 1;
  return { text, cursorStart, cursorEnd: cursorStart + body.length };
}

function toggleTodoSelection(selected: string, fallback: string): FormatMarkdownResult {
  if (!selected.trim()) {
    const formatted = formatTodoSelection(selected, fallback);
    return {
      text: formatted.text,
      cursorStart: formatted.cursorStartOffset,
      cursorEnd: formatted.cursorEndOffset,
    };
  }

  let touchedTask = false;
  const text = selected
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/);
      if (!match) return line;
      touchedTask = true;
      return `${match[1]}${match[2].trim() ? " " : "x"}${match[3]}`;
    })
    .join("\n");

  if (!touchedTask) {
    const formatted = formatTodoSelection(selected, fallback);
    return {
      text: formatted.text,
      cursorStart: formatted.cursorStartOffset,
      cursorEnd: formatted.cursorEndOffset,
    };
  }

  return { text, cursorStart: 0, cursorEnd: text.length };
}

export function formatMarkdown(input: FormatMarkdownInput): FormatMarkdownResult {
  const { value, action, translate } = input;
  const range = normalizeRange(input);
  const start = range.start;
  const end = range.end;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let replacement: string;
  let cursorStartOffset = 0;
  let cursorEndOffset = 0;

  switch (action) {
    case "bold": {
      const body =
        selected || translate("main.formatSample.boldText", { defaultValue: "粗体文本" });
      replacement = `**${body}**`;
      cursorStartOffset = 2;
      cursorEndOffset = 2 + body.length;
      break;
    }
    case "italic": {
      const body =
        selected || translate("main.formatSample.italicText", { defaultValue: "斜体文本" });
      replacement = `*${body}*`;
      cursorStartOffset = 1;
      cursorEndOffset = 1 + body.length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      const level = prefix ? (prefix[1].length < 5 ? prefix[1].length + 1 : 1) : 2;
      return setHeading(value, start, end, level);
    }
    case "heading1":
      return setHeading(value, start, end, 1);
    case "heading2":
      return setHeading(value, start, end, 2);
    case "heading3":
      return setHeading(value, start, end, 3);
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
      replacement = `${newlineBefore}---${newlineAfter}`;
      cursorStartOffset = cursorEndOffset = newlineBefore.length + 3;
      break;
    }
    case "ul": {
      const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
      replacement = formatLinePrefixSelection(selected, () => "- ", fallback);
      cursorStartOffset = selected.includes("\n") || selected ? 0 : 2;
      cursorEndOffset =
        selected.includes("\n") || selected ? replacement.length : replacement.length;
      break;
    }
    case "ol": {
      const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
      let count = 0;
      replacement = formatLinePrefixSelection(selected, () => `${++count}. `, fallback);
      cursorStartOffset = selected.includes("\n") || selected ? 0 : 3;
      cursorEndOffset =
        selected.includes("\n") || selected ? replacement.length : replacement.length;
      break;
    }
    case "todo": {
      const fallback = translate("main.formatSample.todoItem", { defaultValue: "待办事项" });
      const formatted = formatTodoSelection(selected, fallback);
      replacement = formatted.text;
      cursorStartOffset = formatted.cursorStartOffset;
      cursorEndOffset = formatted.cursorEndOffset;
      break;
    }
    case "todoToggle": {
      const fallback = translate("main.formatSample.todoItem", { defaultValue: "待办事项" });
      const formatted = toggleTodoSelection(selected, fallback);
      replacement = formatted.text;
      cursorStartOffset = formatted.cursorStart;
      cursorEndOffset = formatted.cursorEnd;
      break;
    }
    case "code": {
      if (selected.includes("\n")) {
        replacement = "```\n" + selected + "\n```";
        cursorStartOffset = 4;
        cursorEndOffset = 4 + selected.length;
      } else {
        const body = selected || translate("main.formatSample.codeText", { defaultValue: "代码" });
        replacement = `\`${body}\``;
        cursorStartOffset = 1;
        cursorEndOffset = 1 + body.length;
      }
      break;
    }
    case "quote": {
      const fallback = translate("main.formatSample.quoteText", { defaultValue: "引用文本" });
      const body = selected || fallback;
      replacement = body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      cursorStartOffset = selected.includes("\n") ? 0 : 2;
      cursorEndOffset = selected.includes("\n") ? replacement.length : 2 + body.length;
      break;
    }
    case "inlineMath": {
      const body = selected || "E=mc^2";
      replacement = `$${body}$`;
      cursorStartOffset = 1;
      cursorEndOffset = 1 + body.length;
      break;
    }
    case "blockMath": {
      const body = selected || "x^2 + y^2 = r^2";
      replacement = `\n$$\n${body}\n$$\n`;
      cursorStartOffset = 4;
      cursorEndOffset = 4 + body.length;
      break;
    }
  }

  return {
    text: before + replacement + after,
    cursorStart: start + cursorStartOffset,
    cursorEnd: start + cursorEndOffset,
  };
}

export function applyMarkdownFormat({
  textarea,
  action,
  translate,
  setContent,
  markDirty,
  noSelectionScope = "placeholder",
}: {
  textarea: HTMLTextAreaElement;
  action: FormatAction;
  translate: TFunction;
  setContent: (value: string) => void;
  markDirty: () => void;
  noSelectionScope?: NoSelectionScope;
}) {
  const result = formatMarkdown({
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
    action,
    translate,
    noSelectionScope,
  });

  textarea.focus();
  textarea.setSelectionRange(0, textarea.value.length);
  document.execCommand("insertText", false, result.text);
  setContent(result.text);
  markDirty();
  requestAnimationFrame(() => {
    textarea.setSelectionRange(result.cursorStart, result.cursorEnd);
  });
}

export function runEditorCommand(
  textarea: HTMLTextAreaElement | null,
  command: "undo" | "redo",
): boolean {
  if (!textarea || textarea.disabled) return false;
  textarea.focus();
  return document.execCommand(command);
}
