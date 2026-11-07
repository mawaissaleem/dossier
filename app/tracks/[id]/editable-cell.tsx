"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import { updateCell } from "@/app/actions/cells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { linkLabel } from "@/lib/cells";
import type { EditorKind } from "@/lib/table";

// Click-to-edit text/number/date/link cell. A link with a safe `href` shows as an anchor (new tab) plus an Edit button; an unsafe or blank one is plain text. Edit state is local to this component, and the table keys it by application id + column id.
// Enter or blur saves, Escape cancels. The server validates (no rules here beyond the input type) and its error is shown with the typed text kept.
export function EditableCell({ applicationId, columnId, text, label, kind, href = null }: {
  applicationId: number; columnId: number; text: string; label: string; kind: EditorKind; href?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // True while a save is in flight, and after Escape (so the blur that follows is ignored). Refs, because a blur can fire before state updates.
  const locked = useRef(false);
  const refocus = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const num = kind === "number" ? "text-right tabular-nums" : "";
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Only when focus was lost with the input (it is on body); if the user moved to another field or cell, leave it there.
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!editing && refocus.current && lost) trigger.current?.focus();
    refocus.current = false;
  }, [editing]);

  function start() {
    locked.current = false;
    refocus.current = false;
    setDraft(text);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    locked.current = true;
    refocus.current = true;
    setEditing(false);
    setError(null);
  }

  function commit() {
    if (locked.current) return; // a second save while one is in flight
    // A date input reports "" for a half-typed date; saving that would silently clear the stored date.
    if (input.current?.validity.badInput) { setError("Enter a valid date as YYYY-MM-DD."); return; }
    if (draft.trim() === text) { setEditing(false); setError(null); return; } // unchanged: no server call
    locked.current = true;
    startTransition(async () => {
      try {
        const r = await updateCell(applicationId, columnId, draft);
        if (r.ok) { setEditing(false); setError(null); } else { refocus.current = false; setError(r.error); }
      } catch {
        refocus.current = false;
        setError("Could not save. Try again.");
      } finally {
        locked.current = false;
      }
    });
  }

  if (!editing && href) {
    return (
      <span className="flex h-8 items-center gap-1">
        {/* Never fetched or previewed (NFR-2): the browser only follows it on click. */}
        <a href={href} target="_blank" rel="noopener noreferrer" title={href} className="truncate rounded-sm text-accent underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {linkLabel(href)}
        </a>
        <Button ref={trigger} type="button" variant="ghost" size="icon-xs" onClick={start} aria-label={`Edit ${label}`} className="text-muted-foreground">
          <PencilIcon aria-hidden="true" />
        </Button>
      </span>
    );
  }
  if (!editing) {
    return (
      <button ref={trigger} type="button" onClick={start} aria-label={`${label}: ${text || "empty"}`} title={text || undefined} className={cn("block h-8 w-full min-w-24 max-w-72 cursor-text truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", num && "ml-auto", num)}>
        {text}
      </button>
    );
  }
  return (
    <>
      <Input
        ref={input}
        autoFocus
        // type="date": value is always YYYY-MM-DD in the user's calendar, no time zone involved.
        type={kind === "date" ? "date" : "text"}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        // Not type="number": a browser reports "" for bad input like "abc", which would silently save as blank.
        inputMode={kind === "number" ? "decimal" : kind === "link" ? "url" : undefined}
        value={draft}
        readOnly={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { refocus.current = true; commit(); }
          else if (e.key === "Escape" && !locked.current) cancel(); // ignored while saving, so a failed save's error is never hidden
        }}
        className={cn("min-w-32 px-1.5 text-sm", num)}
      />
      {/* w-0 min-w-full: the message wraps inside the column instead of widening it. */}
      {error && <p role="alert" className="mt-1 w-0 min-w-full text-sm text-destructive">{error}</p>}
    </>
  );
}
