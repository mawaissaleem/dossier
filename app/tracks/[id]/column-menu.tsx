"use client";

import { useId, useRef, useState, useTransition } from "react";
import { decodeDefault } from "@/lib/cells";
import type { ColumnItem } from "@/lib/db/columns";
import { OptionEditor, type DeleteChoice, type OptionImpact, type OptionPatch } from "./option-editor";

type Result = { ok: true } | { ok: false; error: string };
type Impact = { ok: true; name: string; valueCount: number; archivedCount: number } | { ok: false; error: string };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Native <details> dropdown: the summary is a keyboard-focusable button (Enter/Space). Escape and focus leaving close it.
// Clicking any item closes it and returns focus to the summary, so a disabled-while-saving item never strands focus.
// `error` renders outside the <details> so a failed action's message is visible after the menu has closed.
function Dropdown({ label, summary, error, children }: { label: string; summary: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <>
    <details
      className="relative inline-block font-normal"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !e.currentTarget.open) return;
        e.currentTarget.open = false;
        e.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label={label} className="cursor-pointer select-none px-1">{summary}</summary>
      <div
        // Capture phase: runs before the item's own onClick, so an item that opens a modal dialog still gets focus moved into it (and back to the summary on close).
        onClickCapture={(e) => {
          if (!(e.target as Element).closest("button")) return;
          const d = e.currentTarget.parentElement as HTMLDetailsElement;
          d.open = false;
          d.querySelector("summary")?.focus();
        }}
        className="absolute left-0 z-10 mt-1 flex min-w-40 flex-col rounded border border-foreground/30 bg-background p-1 text-left"
      >
        {children}
      </div>
    </details>
    {error && <p role="alert" className="text-sm font-normal text-red-600">{error}</p>}
    </>
  );
}

const item = "rounded px-2 py-1 text-left hover:bg-foreground/10 disabled:opacity-50";

// Header menu for one track column: Rename, Edit options (single-select), Use as status column, Default value, Hide, Move left, Move right, Delete (not on Status). No type change (FR-2.5).
// first/last are among the *visible* columns, matching what the move actions do.
export function ColumnMenu({ column, first, last, onRename, onHide, onMove, onLoadImpact, onDelete, onAddOption, onUpdateOption, onReorderOptions, onLoadOptionImpact, onDeleteOption, onSetStatus, onSetDefault }: {
  column: ColumnItem;
  first: boolean;
  last: boolean;
  onRename: (name: string) => Promise<Result>;
  onHide: () => Promise<Result>;
  onMove: (direction: "left" | "right") => Promise<Result>;
  onLoadImpact: () => Promise<Impact>;
  onDelete: () => Promise<Result>;
  onAddOption: (label: string) => Promise<Result>;
  onUpdateOption: (optionId: number, patch: OptionPatch) => Promise<Result>;
  onReorderOptions: (orderedIds: number[]) => Promise<Result>;
  onLoadOptionImpact: (optionId: number) => Promise<OptionImpact>;
  onDeleteOption: (optionId: number, choice: DeleteChoice) => Promise<Result>;
  onSetStatus: () => Promise<Result>;
  onSetDefault: (value: string | number | boolean | null) => Promise<Result>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const delDialog = useRef<HTMLDialogElement>(null);
  const optDialog = useRef<HTMLDialogElement>(null);
  const defDialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [name, setName] = useState(column.name);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(""); // default-value form: text of the input, "true"/"false" for a checkbox, option id for a select
  const [defError, setDefError] = useState<string | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [delError, setDelError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<Result>, onOk?: () => void, fail: (m: string) => void = setMenuError) {
    setMenuError(null); // a retry re-inserts the alert, so the same message is announced again
    startTransition(async () => {
      try {
        const r = await fn();
        if (r.ok) onOk?.();
        else fail(r.error);
      } catch {
        fail("Could not save. Try again.");
      }
    });
  }

  function openRename() {
    setName(column.name);
    setError(null);
    dialog.current?.showModal();
  }

  function openDefault() {
    const current = decodeDefault(column.type, column.defaultValue);
    setDraft(current === null || (column.type === "single_select" && !column.options.some((o) => o.id === current)) ? "" : String(current)); // a dangling option shows as No default
    setDefError(null);
    defDialog.current?.showModal();
  }

  // Blank = no default. The server validates by column type; the select/checkbox drafts are converted to what it expects.
  const draftValue = () => (draft === "" ? null : column.type === "checkbox" ? draft === "true" : column.type === "single_select" ? Number(draft) : draft);

  function openOptions() {
    optDialog.current?.showModal();
  }

  // Fetched fresh on every open; the delete button stays disabled until the real count is shown.
  function openDelete() {
    setImpact(null);
    setDelError(null);
    delDialog.current?.showModal();
    onLoadImpact().then(setImpact, () => setImpact({ ok: false, error: "Could not load the count. Try again." }));
  }

  return (
    <>
      <Dropdown label={`Column menu: ${column.name}`} summary="⋮" error={menuError}>
        <button type="button" onClick={openRename} className={item}>Rename</button>
        {column.type === "single_select" && <button type="button" onClick={openOptions} className={item}>Edit options…</button>}
        {column.type === "single_select" && !column.isStatus && <button type="button" disabled={pending} onClick={() => run(onSetStatus)} className={item}>Use as status column</button>}
        <button type="button" onClick={openDefault} className={item}>Default value…</button>
        <button type="button" disabled={pending} onClick={() => run(onHide)} className={item}>Hide</button>
        <button type="button" disabled={pending || first} onClick={() => run(() => onMove("left"))} className={item}>Move left</button>
        <button type="button" disabled={pending || last} onClick={() => run(() => onMove("right"))} className={item}>Move right</button>
        {!column.isStatus && <button type="button" disabled={pending} onClick={openDelete} className={`${item} text-red-600`}>Delete column…</button>}
      </Dropdown>
      {column.type === "single_select" && <OptionEditor column={column} innerRef={optDialog} onAdd={onAddOption} onUpdate={onUpdateOption} onReorder={onReorderOptions} onLoadImpact={onLoadOptionImpact} onDelete={onDeleteOption} />}
      <dialog
        ref={defDialog}
        aria-labelledby={`${uid}-def-title`}
        onCancel={(e) => pending && e.preventDefault()}
        className="m-auto rounded border border-foreground/30 bg-background p-4 text-left text-base font-normal text-foreground"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => onSetDefault(draftValue()), () => defDialog.current?.close(), setDefError);
          }}
          className="flex flex-col gap-3"
        >
          <h2 id={`${uid}-def-title`} className="text-lg font-semibold">Default value: {column.name}</h2>
          <label htmlFor={`${uid}-def`} className="text-sm">New applications start with</label>
          {column.type === "checkbox" || column.type === "single_select" ? (
            <select id={`${uid}-def`} value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded border border-foreground/30 bg-background px-2 py-1">
              <option value="">No default</option>
              {column.type === "checkbox" ? (
                <>
                  <option value="true">Checked</option>
                  <option value="false">Unchecked</option>
                </>
              ) : (
                column.options.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)
              )}
            </select>
          ) : (
            <input
              id={`${uid}-def`}
              type={column.type === "date" ? "date" : "text"}
              inputMode={column.type === "number" ? "decimal" : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded border border-foreground/30 px-2 py-1"
            />
          )}
          <p className="text-sm text-foreground/70">Applies to new applications only. Existing ones are not changed.</p>
          {defError && <p role="alert" className="text-sm text-red-600">{defError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => defDialog.current?.close()} disabled={pending} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => run(() => onSetDefault(null), () => defDialog.current?.close(), setDefError)} disabled={pending} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">No default</button>
            <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={delDialog}
        aria-labelledby={`${uid}-del-title`}
        onCancel={(e) => pending && e.preventDefault()}
        className="m-auto max-w-md rounded border border-foreground/30 bg-background p-4 text-left text-base font-normal text-foreground"
      >
        <h2 id={`${uid}-del-title`} className="mb-2 text-lg font-semibold">Delete column?</h2>
        {impact === null ? (
          <p>Counting values…</p>
        ) : impact.ok ? (
          <p>
            This permanently deletes the column <strong>{impact.name}</strong> and the values in it: {plural(impact.valueCount, "application")} hold a value
            {impact.archivedCount > 0 ? `, including ${impact.archivedCount} archived` : ""}. This cannot be undone.
          </p>
        ) : (
          <p role="alert" className="text-red-600">{impact.error}</p>
        )}
        {delError && <p role="alert" className="mt-2 text-sm text-red-600">{delError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => delDialog.current?.close()} disabled={pending} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            disabled={pending || !impact?.ok}
            onClick={() => run(onDelete, () => delDialog.current?.close(), setDelError)}
            className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete column"}
          </button>
        </div>
      </dialog>
      <dialog
        ref={dialog}
        aria-labelledby={`${uid}-title`}
        onCancel={(e) => pending && e.preventDefault()}
        className="m-auto rounded border border-foreground/30 bg-background p-4 text-left text-base font-normal text-foreground"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => onRename(name), () => dialog.current?.close(), setError);
          }}
          className="flex flex-col gap-3"
        >
          <h2 id={`${uid}-title`} className="text-lg font-semibold">Rename column</h2>
          <label htmlFor={`${uid}-name`} className="text-sm">Name</label>
          <input id={`${uid}-name`} required value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-foreground/30 px-2 py-1" />
          <p className="text-sm text-foreground/70">Values in this column are kept.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} disabled={pending} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">{pending ? "Saving…" : "Rename"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

// "Hidden columns (n)" list with Show, so hiding is always reversible. Renders nothing when none are hidden.
export function HiddenColumns({ columns, onShow }: { columns: ColumnItem[]; onShow: (id: number) => Promise<Result> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (columns.length === 0) return null;
  return (
    <Dropdown label={`Hidden columns (${columns.length})`} summary={`Hidden columns (${columns.length})`} error={error}>
      {columns.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2 px-2 py-1">
          <span>{c.name}</span>
          <button
            type="button"
            disabled={pending}
            aria-label={`Show ${c.name}`}
            className="underline disabled:opacity-50"
            onClick={() =>
              startTransition(async () => {
                try {
                  const r = await onShow(c.id);
                  setError(r.ok ? null : r.error);
                } catch {
                  setError("Could not save. Try again.");
                }
              })
            }
          >
            Show
          </button>
        </div>
      ))}
    </Dropdown>
  );
}
