"use client";

import { useId, useRef, useState } from "react";
import { createNote } from "@/app/actions/notes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_BODY_MAX } from "@/lib/notes";

// The "add a note" form (FR-11.1). Ctrl/Cmd+Enter submits. The box keeps the text until the server accepts it, and is cleared only then.
// `sending` (a ref) stops a second submit in the same tick, before the disabled state has rendered.
export function AddNote({ applicationId }: { applicationId: number }) {
  const uid = useId();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: boolean } | null>(null);
  const [added, setAdded] = useState(false);
  const sending = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setAdded(false);
    try {
      const r = await createNote(applicationId, body);
      if (r.ok) { setBody(""); setAdded(true); }
      else setError({ text: r.error, field: r.field === "body" });
    } catch {
      setError({ text: "Could not save. Try again.", field: false });
    }
    sending.current = false;
    setBusy(false);
    field.current?.focus(); // the disabled box dropped focus
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-2">
      <Label htmlFor={`${uid}-note`} className="sr-only">New note</Label>
      <Textarea
        ref={field}
        id={`${uid}-note`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
        readOnly={busy}
        rows={3}
        maxLength={NOTE_BODY_MAX + 1000} // a soft cap on typing; the exact limit is enforced on the server and reported inline
        placeholder="Write a note (Ctrl+Enter to add)"
        aria-invalid={error?.field ? true : undefined}
        aria-describedby={error ? `${uid}-err` : undefined}
      />
      {error && <p id={`${uid}-err`} role="alert" className="text-sm text-destructive">{error.text}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add note"}</Button>
        <p role="status" className="text-sm text-muted-foreground">{added ? "Note added." : ""}</p>
      </div>
    </form>
  );
}
