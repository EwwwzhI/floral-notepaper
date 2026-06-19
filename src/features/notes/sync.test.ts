import { describe, expect, test } from "vitest";
import { shouldReloadOpenNote } from "./sync";

describe("note window synchronization", () => {
  test("reloads the same clean note saved by another window", () => {
    expect(
      shouldReloadOpenNote(
        { noteId: "note-1", sourceWindow: "notepad-note-1" },
        "note-1",
        "main",
        false,
      ),
    ).toBe(true);
  });

  test("does not overwrite local changes or react to its own save", () => {
    const event = { noteId: "note-1", sourceWindow: "notepad-note-1" };
    expect(shouldReloadOpenNote(event, "note-1", "main", true)).toBe(false);
    expect(shouldReloadOpenNote(event, "note-1", "notepad-note-1", false)).toBe(false);
  });

  test("ignores changes for another note and legacy generic events", () => {
    expect(
      shouldReloadOpenNote(
        { noteId: "note-2", sourceWindow: "notepad-note-2" },
        "note-1",
        "main",
        false,
      ),
    ).toBe(false);
    expect(shouldReloadOpenNote(null, "note-1", "main", false)).toBe(false);
  });
});
