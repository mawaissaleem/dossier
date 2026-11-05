"use client";

import { useEffect, useId, useRef } from "react";
import { errorNamesColumn, inputKind, splitEssentials, type FormState } from "@/lib/application-form";
import type { ColumnItem } from "@/lib/db/columns";

const box = "rounded border border-foreground/30 px-2 py-1";

// Essentials first (see splitEssentials), every other column in a closed <details> that stays mounted, so nothing typed is lost
// by collapsing. `error` is the submit error: if it names a field inside the section, the section opens (parents clear it at the start of a submit so a repeat reopens it). State is controlled by the parent (values in, onChange out), so the same
// component serves the add form and the detail-page edit form. The title input is part of it. A column absent from `state` shows blank.
export function ApplicationFields({ title, onTitleChange, columns, state, onChange, error }: { title: string; onTitleChange: (title: string) => void; columns: ColumnItem[]; state: FormState; onChange: (columnId: number, value: string | boolean) => void; error?: string | null }) {
  const uid = useId();
  const more = useRef<HTMLDetailsElement>(null);
  const { essentials, rest } = splitEssentials(columns);
  const errorInRest = errorNamesColumn(error, rest);
  useEffect(() => {
    if (errorInRest && more.current) more.current.open = true;
  }, [errorInRest, error]);
  const field = (c: ColumnItem) => {
    const id = `${uid}-${c.id}`;
    const kind = inputKind(c.type);
    const v = state[c.id];
    const label = <label htmlFor={id} className="text-sm">{c.name}{c.hidden && " (hidden)"}</label>;
    return (
      <div key={c.id} className="flex items-center gap-2">
        {kind === "checkbox" ? (
          <>
            <input id={id} type="checkbox" checked={v === true} onChange={(e) => onChange(c.id, e.target.checked)} />
            {label}
          </>
        ) : (
          <>
            {label}
            {kind === "select" ? (
              <select id={id} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(c.id, e.target.value)} className={box}>
                <option value=""></option>
                {c.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            ) : (
              <input
                id={id}
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "number" ? "decimal" : undefined}
                value={typeof v === "string" ? v : ""}
                onChange={(e) => onChange(c.id, e.target.value)}
                className={box}
              />
            )}
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <label htmlFor={`${uid}-title`} className="text-sm">Title</label>
        <input id={`${uid}-title`} value={title} onChange={(e) => onTitleChange(e.target.value)} className={box} />
      </div>
      {essentials.map(field)}
      {rest.length > 0 && (
        <details ref={more} className="flex flex-col gap-2">
          <summary className="cursor-pointer text-sm">More fields ({rest.length})</summary>
          <div className="mt-2 flex flex-col items-start gap-2">{rest.map(field)}</div>
        </details>
      )}
    </>
  );
}
