"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { PencilIcon } from "lucide-react";
import { updateApplication } from "@/app/actions/applications";
import { ApplicationFields } from "@/app/application-fields";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { buildValues, changedState, errorField, initialState, type FormState } from "@/lib/application-form";
import type { CellScalar } from "@/lib/cells";
import type { ColumnItem } from "@/lib/db/columns";

// View / Edit toggle: `children` is the server-rendered read-only view (clickable links, coloured chips), shown until "Edit".
// The page header lives here so "Edit" can sit in its actions. The form is the same ApplicationFields as the add form.
// Archived applications are editable too and stay archived (shown as a muted badge).
export function EditApplication({ id, title, back, archived, columns, values, children }: {
  id: number; title: string; back: { href: string; label: string }; archived: boolean; columns: ColumnItem[]; values: Record<number, CellScalar | null>; children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  // The Edit button unmounts while editing, so focus would fall to <body>: the form takes it on open, the button gets it back on close.
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const header = (
    <PageHeader
      title={title}
      back={back}
      description={archived ? <span className="inline-flex h-5 items-center rounded-sm bg-muted px-2 text-xs font-medium text-muted-foreground">Archived</span> : undefined}
      actions={editing ? undefined : <Button ref={editButton} type="button" variant="outline" onClick={() => setEditing(true)}><PencilIcon aria-hidden />Edit</Button>}
    />
  );
  if (!editing) {
    return (
      <>
        {header}
        {children}
      </>
    );
  }
  return (
    <>
      {header}
      <EditForm id={id} title={title} columns={columns} values={values} onDone={() => setEditing(false)} />
    </>
  );
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
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => form.current?.querySelector("input")?.focus(), []); // the title, the form's first field

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
    <form ref={form} aria-label="Edit application" onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <ApplicationFields title={title} onTitleChange={setTitle} columns={columns} state={fields} onChange={(cid, v) => setFields((f) => ({ ...f, [cid]: v }))} error={error} />
      {error && errorField(error, columns) === null && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
