import { describe, expect, test } from "vitest";
import { formatTodoSelection } from "./taskList";

describe("task list formatting", () => {
  test("inserts fallback todo when selection is empty", () => {
    expect(formatTodoSelection("", "待办事项")).toEqual({
      text: "- [ ] 待办事项",
      cursorStartOffset: 6,
      cursorEndOffset: 10,
    });
  });

  test("formats a single selected line", () => {
    expect(formatTodoSelection("buy milk", "todo").text).toBe("- [ ] buy milk");
  });

  test("formats multiple selected lines", () => {
    expect(formatTodoSelection("a\nb", "todo")).toEqual({
      text: "- [ ] a\n- [ ] b",
      cursorStartOffset: 0,
      cursorEndOffset: 15,
    });
  });
});
