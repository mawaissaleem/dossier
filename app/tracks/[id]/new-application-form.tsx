"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createApplication } from "@/app/actions/applications";
import { ApplicationFields } from "@/app/application-fields";
import { buildCreateValues, defaultState, errorField, type FormState } from "@/lib/application-form";
import type { ColumnItem } from "@/lib/db/columns";

// Hidden columns are shown too (marked), so no column is unreachable. `columns` comes from the page, so a column added through
// the header "+" appears here after the router refresh, and the state (keyed by column id) keeps what was typed in the others.
export function NewApplicationForm({ trackId, columns }: { trackId: number; columns: ColumnItem[] }) {
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<FormState>({}); // only what the user touched; the rest shows the column default (defaultState)
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); // so the same error on a second submit is a change again and reopens "More fields"
    startTransition(async () => {
      try {
        const r = await createApplication(title, trackId, buildCreateValues(columns, fields));
        if (r.ok) {
          setTitle("");
          setFields({});
        } else {
          setError(r.error);
        }
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form aria-label="Add application" onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
      <ApplicationFields title={title} onTitleChange={setTitle} columns={columns} state={{ ...defaultState(columns), ...fields }} onChange={(id, v) => setFields((f) => ({ ...f, [id]: v }))} error={error} />
      {error && errorField(error, columns) === null && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}
