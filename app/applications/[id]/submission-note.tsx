"use client";

import { PencilIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { editSubmissionNote } from "@/app/actions/submissions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// The note of one submission with the inline "Edit note" (FR-7.6: the note is the only thing that can change after creation).
// Focus: opening goes to the field; Save or Cancel puts it back on "Edit note" (that button unmounts while editing).
export function SubmissionNote({ id, date, note }: { id: number; date: string; note: string | null }) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    (editing ? field : wasEditing.current ? editButton : null)?.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await editSubmissionNote(id, draft.trim() || null);
      if (!r.ok) { setError(r.error); setBusy(false); return; }
    } catch {
      setError("Could not save. Try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setSaved(true);
    setEditing(false);
  }

  if (editing) {
    return (
      <form onSubmit={save} className="flex flex-col gap-2 px-3 pb-3 pl-9">
        <Label htmlFor={`${uid}-note`} className="sr-only">Note for the submission of {date}</Label>
        <Textarea ref={field} id={`${uid}-note`} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} rows={3} aria-invalid={error ? true : undefined} aria-describedby={error ? `${uid}-err` : undefined} />
        {error && <p id={`${uid}-err`} role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save note"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <div className="px-3 pb-2 pl-9">
      {note && <p className="text-sm break-words whitespace-pre-wrap">{note}</p>}
      <div className="flex items-center gap-2">
        <Button ref={editButton} type="button" variant="ghost" size="sm" aria-label={`Edit note, submission of ${date}`} onClick={() => { setDraft(note ?? ""); setError(null); setSaved(false); setEditing(true); }}>
          <PencilIcon aria-hidden />Edit note
        </Button>
        <p role="status" className="text-sm text-muted-foreground">{saved ? "Note saved." : ""}</p>
      </div>
    </div>
  );
}
