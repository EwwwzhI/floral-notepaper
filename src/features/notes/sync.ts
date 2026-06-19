import type { NotesChangedEvent } from "./types";

export function shouldReloadOpenNote(
  event: NotesChangedEvent | null,
  currentNoteId: string | null,
  currentWindowLabel: string,
  hasLocalChanges: boolean,
): boolean {
  return Boolean(
    event?.noteId &&
    event.noteId === currentNoteId &&
    event.sourceWindow !== currentWindowLabel &&
    !hasLocalChanges,
  );
}
