"use client";

import { useId, useRef, useState, useTransition } from "react";
import { decodeDefault } from "@/lib/cells";
import { createLatest } from "@/lib/latest";
import type { ColumnItem } from "@/lib/db/columns";
import { ArrowLeftIcon, ArrowRightIcon, CircleDotIcon, EllipsisVerticalIcon, EyeOffIcon, ListIcon, PencilIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useReturnFocus } from "@/components/use-return-focus";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OptionEditor, type DeleteChoice, type OptionImpact, type OptionPatch } from "./option-editor";

type Result = { ok: true } | { ok: false; error: string };
type Impact = { ok: true; name: string; valueCount: number; archivedCount: number } | { ok: false; error: string };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Radix dropdown, portalled to <body> so the table's scroll area cannot clip it. Keyboard: Enter/Space/arrows open, arrows move, Escape closes.
// `act(fn)` defers an item's action until the menu has closed and focus is back on the trigger, so a disabled-while-saving item never strands
// focus and a modal dialog opened by fn returns focus to the trigger when it closes.
// `error` renders outside the menu so a failed action's message is visible after the menu has closed.
function Dropdown({ label, summary, size, error, children }: { label: string; summary: React.ReactNode; size: "icon-xs" | "sm"; error?: string | null; children: (act: (fn: () => void) => () => void) => React.ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const next = useRef<(() => void) | null>(null);
  const act = (fn: () => void) => () => {
    next.current = fn;
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} type="button" variant="ghost" size={size} aria-label={label} className="text-muted-foreground">{summary}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-auto min-w-40"
          onCloseAutoFocus={(e) => {
            const fn = next.current;
            next.current = null;
            if (!fn) return; // no item chosen: keep Radix's default (trigger, unless the user clicked elsewhere)
            e.preventDefault();
            trigger.current?.focus();
            fn();
          }}
        >
          {children(act)}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p role="alert" className="w-0 min-w-full text-xs font-normal text-destructive">{error}</p>}
    </>
  );
}

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [optOpen, setOptOpen] = useState(false);
  const [defOpen, setDefOpen] = useState(false);
  const uid = useId();
  const back = useReturnFocus();
  const [name, setName] = useState(column.name);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(""); // default-value form: text of the input, "true"/"false" for a checkbox, option id for a select
  const [defError, setDefError] = useState<string | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [delError, setDelError] = useState<string | null>(null);
  const [latest] = useState(createLatest); // a late count from an earlier open must not replace the current one
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
    back.remember();
    setRenameOpen(true);
  }

  function openDefault() {
    const current = decodeDefault(column.type, column.defaultValue);
    setDraft(current === null || (column.type === "single_select" && !column.options.some((o) => o.id === current)) ? "" : String(current)); // a dangling option shows as No default
    setDefError(null);
    back.remember();
    setDefOpen(true);
  }

  // Blank = no default. The server validates by column type; the select/checkbox drafts are converted to what it expects.
  const draftValue = () => (draft === "" ? null : column.type === "checkbox" ? draft === "true" : column.type === "single_select" ? Number(draft) : draft);

  function openOptions() {
    back.remember();
    setOptOpen(true);
  }

  // Fetched fresh on every open; the delete button stays disabled until the real count is shown.
  function openDelete() {
    setImpact(null);
    setDelError(null);
    back.remember();
    setDelOpen(true);
    const token = latest.start();
    onLoadImpact().then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not load the count. Try again." }),
    );
  }

  return (
    <>
      <Dropdown label={`Column menu: ${column.name}`} summary={<EllipsisVerticalIcon aria-hidden="true" />} size="icon-xs" error={menuError}>
        {(act) => (
          <>
            <DropdownMenuItem onSelect={act(openRename)}><PencilIcon aria-hidden="true" />Rename</DropdownMenuItem>
            {column.type === "single_select" && <DropdownMenuItem onSelect={act(openOptions)}><ListIcon aria-hidden="true" />Edit options…</DropdownMenuItem>}
            {column.type === "single_select" && !column.isStatus && <DropdownMenuItem disabled={pending} onSelect={act(() => run(onSetStatus))}><CircleDotIcon aria-hidden="true" />Use as status column</DropdownMenuItem>}
            <DropdownMenuItem onSelect={act(openDefault)}><SlidersHorizontalIcon aria-hidden="true" />Default value…</DropdownMenuItem>
            <DropdownMenuItem disabled={pending} onSelect={act(() => run(onHide))}><EyeOffIcon aria-hidden="true" />Hide</DropdownMenuItem>
            <DropdownMenuItem disabled={pending || first} onSelect={act(() => run(() => onMove("left")))}><ArrowLeftIcon aria-hidden="true" />Move left</DropdownMenuItem>
            <DropdownMenuItem disabled={pending || last} onSelect={act(() => run(() => onMove("right")))}><ArrowRightIcon aria-hidden="true" />Move right</DropdownMenuItem>
            {!column.isStatus && <DropdownMenuItem variant="destructive" disabled={pending} onSelect={act(openDelete)}><Trash2Icon aria-hidden="true" />Delete column…</DropdownMenuItem>}
          </>
        )}
      </Dropdown>
      {column.type === "single_select" && <OptionEditor column={column} open={optOpen} onOpenChange={setOptOpen} onCloseAutoFocus={back.onCloseAutoFocus} onAdd={onAddOption} onUpdate={onUpdateOption} onReorder={onReorderOptions} onLoadImpact={onLoadOptionImpact} onDelete={onDeleteOption} />}
      <Dialog open={defOpen} onOpenChange={(o) => { if (o || !pending) setDefOpen(o); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md" onCloseAutoFocus={back.onCloseAutoFocus}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => onSetDefault(draftValue()), () => setDefOpen(false), setDefError);
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Default value: {column.name}</DialogTitle>
              <DialogDescription>Applies to new applications only. Existing ones are not changed.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-def`}>New applications start with</Label>
              {column.type === "checkbox" || column.type === "single_select" ? (
                <NativeSelect id={`${uid}-def`} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full">
                  <NativeSelectOption value="">No default</NativeSelectOption>
                  {column.type === "checkbox" ? (
                    <>
                      <NativeSelectOption value="true">Checked</NativeSelectOption>
                      <NativeSelectOption value="false">Unchecked</NativeSelectOption>
                    </>
                  ) : (
                    column.options.map((o) => <NativeSelectOption key={o.id} value={String(o.id)}>{o.label}</NativeSelectOption>)
                  )}
                </NativeSelect>
              ) : (
                <Input
                  id={`${uid}-def`}
                  type={column.type === "date" ? "date" : "text"}
                  inputMode={column.type === "number" ? "decimal" : undefined}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            </div>
            {defError && <p role="alert" className="text-sm text-destructive">{defError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setDefOpen(false)}>Cancel</Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => onSetDefault(null), () => setDefOpen(false), setDefError)}>No default</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        onCloseAutoFocus={back.onCloseAutoFocus}
        title="Delete column?"
        description={
          impact === null ? (
            "Counting values…"
          ) : impact.ok ? (
            <>
              This permanently deletes the column <strong>{impact.name}</strong> and the values in it: {plural(impact.valueCount, "application")} hold a value
              {impact.archivedCount > 0 ? `, including ${impact.archivedCount} archived` : ""}. This cannot be undone.
            </>
          ) : (
            <span role="alert" className="text-destructive">{impact.error}</span>
          )
        }
        error={delError}
        confirmLabel="Delete column"
        busyLabel="Deleting…"
        confirmDisabled={!impact?.ok}
        busy={pending}
        onConfirm={() => run(onDelete, () => setDelOpen(false), setDelError)}
      />
      <Dialog open={renameOpen} onOpenChange={(o) => { if (o || !pending) setRenameOpen(o); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md" onCloseAutoFocus={back.onCloseAutoFocus}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => onRename(name), () => setRenameOpen(false), setError);
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Rename column</DialogTitle>
              <DialogDescription>Values in this column are kept.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-name`}>Name</Label>
              <Input id={`${uid}-name`} required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Rename"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// "Hidden columns (n)" list with Show, so hiding is always reversible. Renders nothing when none are hidden.
export function HiddenColumns({ columns, onShow }: { columns: ColumnItem[]; onShow: (id: number) => Promise<Result> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (columns.length === 0) return null;
  return (
    <Dropdown label={`Hidden columns (${columns.length})`} summary={<><EyeOffIcon aria-hidden="true" />Hidden columns ({columns.length})</>} size="sm" error={error}>
      {(act) =>
        columns.map((c) => (
          <DropdownMenuItem
            key={c.id}
            disabled={pending}
            aria-label={`Show ${c.name}`}
            className="justify-between gap-4"
            onSelect={act(() =>
              startTransition(async () => {
                try {
                  const r = await onShow(c.id);
                  setError(r.ok ? null : r.error);
                } catch {
                  setError("Could not save. Try again.");
                }
              }),
            )}
          >
            <span>{c.name}</span>
            <span className="text-muted-foreground">Show</span>
          </DropdownMenuItem>
        ))
      }
    </Dropdown>
  );
}
