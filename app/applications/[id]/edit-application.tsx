"use client";

import { useState, useTransition, type ReactNode } from "react";
import { updateApplication } from "@/app/actions/applications";
import { ApplicationFields } from "@/app/application-fields";
import { buildValues, changedState, initialState, type FormState } from "@/lib/application-form";
import type { CellScalar } from "@/lib/cells";
import type { ColumnItem } from "@/lib/db/columns";

// View / Edit toggle: `children` is the server-rendered read-only view (clickable links, coloured chips), shown until "Edit".
// The form is the same ApplicationFields as the add form. Archived applications are editable too and stay archived.
export function EditApplication({ id, title, columns, values, children }: {
  id: number; title: string; columns: ColumnItem[]; values: Record<number, CellScalar | null>; children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <>
        <button type="button" className="rounded border px-3 py-1" onClick={() => setEditing(true)}>Edit</button>
        {children}
      </>
    );
  }
  return <EditForm id={id} title={title} columns={columns} values={values} onDone={() => setEditing(false)} />;
}

// Mounted fresh on each "Edit", so it starts from the values the page has now. All columns start filled in from the loaded values
// (no defaults); only the fields that differ from them are sent (see changedState), so a cell edited in the table in another tab
// and not touched here is left alone. The title is always sent (required), trimmed on the server.
function EditForm({ id, title: loadedTitle, columns, values, onDone }: {
  id: number; title: string; columns: ColumnItem[]; values: Record<number, CellScalar | null>; onDone: () => void;
}) {
  const [initial] = useState(() => initialState(columns, values));
  const [title, setTitle] = useState(loadedTitle);
  const [fields, setFields] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); // so the same error on a second submit is a change again and reopens "More fields"
    const changed = buildValues(columns, changedState(columns, fields, initial));
    if (changed.length === 0 && title.trim() === loadedTitle) return onDone(); // nothing to save
    startTransition(async () => {
      try {
        const r = await updateApplication(id, title, changed);
        if (r.ok) onDone();
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form aria-label="Edit application" onSubmit={submit} className="mt-4 flex flex-col items-start gap-2">
      <ApplicationFields title={title} onTitleChange={setTitle} columns={columns} state={fields} onChange={(cid, v) => setFields((f) => ({ ...f, [cid]: v }))} error={error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={pending} className="rounded border px-3 py-1" onClick={onDone}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
