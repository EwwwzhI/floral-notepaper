export interface FormatSelectionResult {
  text: string;
  cursorStartOffset: number;
  cursorEndOffset: number;
}

export function formatTodoSelection(selected: string, fallback: string): FormatSelectionResult {
  if (selected.includes("\n")) {
    const text = selected
      .split("\n")
      .map((line) => (line.trim() ? `- [ ] ${line}` : "- [ ] "))
      .join("\n");
    return { text, cursorStartOffset: 0, cursorEndOffset: text.length };
  }

  const body = selected || fallback;
  return {
    text: `- [ ] ${body}`,
    cursorStartOffset: 6,
    cursorEndOffset: 6 + body.length,
  };
}
