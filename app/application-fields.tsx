"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { BAD_DATE, errorField, errorNamesColumn, inputKind, splitEssentials, type FormState } from "@/lib/application-form";
import type { ColumnItem } from "@/lib/db/columns";

// Essentials first (see splitEssentials), every other column in a closed <details> that stays mounted, so nothing typed is lost
// by collapsing. `error` is the submit error: if it names a field inside the section, the section opens (parents clear it at the start of a submit so a repeat reopens it).
// An error that names a field (errorField) is shown under that field and marks it aria-invalid; any other error is the parent's form-level alert.
// State is controlled by the parent (values in, onChange out), so the same component serves the add form and the detail-page edit form. The title input is part of it. A column absent from `state` shows blank.
export function ApplicationFields({ title, onTitleChange, columns, state, onChange, error }: { title: string; onTitleChange: (title: string) => void; columns: ColumnItem[]; state: FormState; onChange: (columnId: number, value: string | boolean) => void; error?: string | null }) {
  const uid = useId();
  const more = useRef<HTMLDetailsElement>(null);
  const { essentials, rest } = splitEssentials(columns);
  const errorInRest = errorNamesColumn(error, rest);
  const bad = errorField(error, columns);
  useEffect(() => {
    if (errorInRest && more.current) more.current.open = true;
  }, [errorInRest, error]);
  // aria-describedby points at the message under the field; it exists only while this field is the one the error names.
  const invalid = (key: number | "title", id: string) => bad === key ? ({ "aria-invalid": true, "aria-describedby": `${id}-err` } as const) : {};
  const message = (key: number | "title", id: string) => bad === key && <p id={`${id}-err`} role="alert" className="text-sm text-destructive">{error}</p>;
  const field = (c: ColumnItem) => {
    const id = `${uid}-${c.id}`;
    const kind = inputKind(c.type);
    const v = state[c.id];
    const read = (el: HTMLInputElement) => onChange(c.id, el.validity.badInput ? BAD_DATE : el.value);
    const label = <Label htmlFor={id} className={kind === "checkbox" ? "" : "text-muted-foreground"}>{c.name}{c.hidden && <span className="font-normal text-muted-foreground">(hidden)</span>}</Label>;
    return (
      <div key={c.id} className="flex min-w-0 flex-col gap-1.5">
        {kind === "checkbox" ? (
          <div className="flex h-8 items-center gap-2">
            <Checkbox id={id} checked={v === true} onCheckedChange={(c2) => onChange(c.id, c2 === true)} {...invalid(c.id, id)} />
            {label}
          </div>
        ) : (
          <>
            {label}
            {kind === "select" ? (
              <NativeSelect id={id} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(c.id, e.target.value)} className="w-full" {...invalid(c.id, id)}>
                <NativeSelectOption value=""></NativeSelectOption>
                {c.options.map((o) => <NativeSelectOption key={o.id} value={o.id}>{o.label}</NativeSelectOption>)}
              </NativeSelect>
            ) : (
              <Input
                id={id}
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "number" ? "decimal" : c.type === "link" ? "url" : undefined}
                value={typeof v === "string" && !(kind === "date" && v === BAD_DATE) ? v : ""}
                // A half-typed or impossible date reads as "" (validity.badInput), which would save as blank and silently clear a
                // stored date; record it as BAD_DATE so the save is refused. Read while typing, not at submit: Firefox resets the input on
                // blur. On keyup too: Firefox fires no input event when only badInput changes (e.g. the last segment cleared = blank).
                onChange={(e) => read(e.target)}
                onKeyUp={kind === "date" ? (e) => read(e.currentTarget) : undefined}
                {...invalid(c.id, id)}
              />
            )}
          </>
        )}
        {message(c.id, id)}
      </div>
    );
  };
  const titleId = `${uid}-title`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={titleId}>Title</Label>
          <Input id={titleId} value={title} onChange={(e) => onTitleChange(e.target.value)} className="font-medium" {...invalid("title", titleId)} />
          {message("title", titleId)}
        </div>
        {essentials.map(field)}
      </div>
      {rest.length > 0 && (
        <details ref={more} className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open:rotate-90" />
            More fields ({rest.length})
          </summary>
          <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">{rest.map(field)}</div>
        </details>
      )}
    </div>
  );
}
