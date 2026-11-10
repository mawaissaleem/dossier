import type { NoteItem as NoteData } from "@/lib/db/notes";
import { NoteTime } from "./note-time";

// One note. Plain text only: React escapes it and `whitespace-pre-wrap` keeps the line breaks; no HTML or markdown is rendered.
// 7.4 puts these items in the merged timeline with the log events.
export function NoteItem({ note }: { note: NoteData }) {
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground"><NoteTime iso={note.createdAt.toISOString()} /></p>
      <p className="mt-1 text-sm break-words whitespace-pre-wrap">{note.body}</p>
    </li>
  );
}

// Newest first (the data layer's order).
export function NoteList({ notes }: { notes: NoteData[] }) {
  return (
    <ol aria-label="Notes" className="mt-3 flex flex-col gap-2">
      {notes.map((n) => <NoteItem key={n.id} note={n} />)}
    </ol>
  );
}
