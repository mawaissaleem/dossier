"use client";

import { useId, useRef, useState, useTransition } from "react";
import { columnTypeOptions } from "@/lib/column-types";
import type { ColumnType } from "@/lib/db/schema";

export type AddColumnResult = { ok: true } | { ok: false; error: string }; // the action's result (with an id) fits

// Native <dialog>: showModal() moves focus inside, Escape closes, and the browser returns focus to the trigger on close.
export function AddColumnDialog({ onSubmit }: { onSubmit: (name: string, type: ColumnType) => Promise<AddColumnResult> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>(columnTypeOptions[0].type);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await onSubmit(name, type);
        if (r.ok) ref.current?.close();
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  // Escape and Cancel are ignored while saving (as in 1.6), so a late result can never land on a closed or reopened dialog.
  function cancel(e: React.SyntheticEvent) {
    if (pending) e.preventDefault();
  }

  // Reset on every close (Escape, Cancel, success) so reopening starts clean; a failed submit keeps the dialog open and the input.
  function reset() {
    setName("");
    setType(columnTypeOptions[0].type);
    setError(null);
  }

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} aria-label="Add column" className="px-1 font-semibold">
        +
      </button>
      <dialog ref={ref} onClose={reset} onCancel={cancel} aria-labelledby={`${uid}-title`} className="m-auto rounded border border-foreground/30 bg-background p-4 text-left text-base font-normal text-foreground">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <h2 id={`${uid}-title`} className="text-lg font-semibold">Add column</h2>
          <label htmlFor={`${uid}-name`} className="text-sm">Name</label>
          <input
            id={`${uid}-name`}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-foreground/30 px-2 py-1"
          />
          <label htmlFor={`${uid}-type`} className="text-sm">Type</label>
          <select
            id={`${uid}-type`}
            value={type}
            onChange={(e) => setType(e.target.value as ColumnType)}
            aria-describedby={`${uid}-hint`}
            className="rounded border border-foreground/30 px-2 py-1"
          >
            {columnTypeOptions.map((o) => (
              <option key={o.type} value={o.type}>{o.label}</option>
            ))}
          </select>
          <p id={`${uid}-hint`} className="text-sm text-foreground/70">The type cannot be changed later. To use a different type, add a new column.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
              {pending ? "Adding…" : "Add column"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
