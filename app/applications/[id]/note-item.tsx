import { NoteTime } from "./note-time";

// One note in the history. Plain text only: React escapes it and `whitespace-pre-wrap` keeps the line breaks; no HTML or markdown is rendered.
export function NoteItem({ body, at }: { body: string; at: Date }) {
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground"><NoteTime iso={at.toISOString()} /></p>
      <p className="mt-1 text-sm break-words whitespace-pre-wrap">{body}</p>
    </li>
  );
}
