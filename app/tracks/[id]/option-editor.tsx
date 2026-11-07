"use client";

import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { CheckIcon, GripVerticalIcon, Trash2Icon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ColumnItem, OptionItem } from "@/lib/db/columns";
import { PALETTE, chipClasses } from "@/lib/colors";
import { createLatest } from "@/lib/latest";
import { MAX_OPTION_LABEL } from "@/lib/options";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useReturnFocus } from "@/components/use-return-focus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OptionChip } from "@/app/option-chip";

type Result = { ok: true } | { ok: false; error: string };
export type OptionPatch = { label: string; color: string };
export type OptionImpact = { ok: true; label: string; useCount: number; archivedCount: number } | { ok: false; error: string };
export type DeleteChoice = { confirm: true; reassignTo: number | null; expectedUseCount: number };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Colour picker: one swatch per palette token on the theme chip tokens. A Radix radio group, so it is one Tab stop and arrows move the choice.
// The selected swatch has a check and a solid foreground border (not colour alone); the accessible name is the token.
function ColorPicker({ value, onChange, name }: { value: string; onChange: (token: string) => void; name: string }) {
  return (
    <RadioGroup.Root value={value} onValueChange={onChange} aria-label={`Colour of option ${name}`} orientation="horizontal" className="flex items-center gap-1">
      {PALETTE.map((t) => (
        <RadioGroup.Item
          key={t}
          value={t}
          aria-label={t}
          title={t}
          className={`flex size-5 items-center justify-center rounded-full border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-2 data-[state=checked]:border-foreground ${chipClasses(t)}`}
        >
          <RadioGroup.Indicator><CheckIcon aria-hidden="true" className="size-3" /></RadioGroup.Indicator>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

// One option: grip handle, chip preview of the draft, label input, colour swatches, Save, Delete.
// The parent keys the row by id+label+color, so after a save the draft resets to the stored values.
function OptionRow({ option, locked, onSave, onDelete }: { option: OptionItem; locked: boolean; onSave: (patch: OptionPatch) => Promise<Result>; onDelete: () => void }) {
  const [label, setLabel] = useState(option.label);
  const [color, setColor] = useState(option.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: option.id, disabled: locked });
  // No native `disabled` while saving: a disabled button drops focus to <body>; useSortable sets aria-disabled and ignores input.
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded-lg border border-border p-2 ${isDragging ? "relative z-10 bg-muted" : "bg-card"}`}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            try {
              const r = await onSave({ label, color });
              setError(r.ok ? null : r.error);
            } catch {
              setError("Could not save. Try again.");
            }
          });
        }}
      >
        <Button type="button" variant="ghost" size="icon-sm" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder option ${option.label}`} className="cursor-grab touch-none text-muted-foreground aria-disabled:opacity-50">
          <GripVerticalIcon aria-hidden="true" />
        </Button>
        <span aria-hidden="true" className="w-28 shrink-0 [&>span]:max-w-full"><OptionChip option={{ label: label.trim() || "…", color }} /></span>
        <Input aria-label={`Label of option ${option.label}`} required maxLength={MAX_OPTION_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} className="w-40 flex-1" />
        <ColorPicker value={color} onChange={setColor} name={option.label} />
        <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Save option ${option.label}`}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={locked} onClick={onDelete} aria-label={`Delete option ${option.label}`} title="Delete…" className="text-destructive hover:text-destructive">
          <Trash2Icon aria-hidden="true" />
        </Button>
      </form>
      {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </li>
  );
}

// Dialog listing a single-select column's options in position order, with add / rename / recolour. Values keep following
// their option (FR-3.3). Drag the handle (or Space/Enter then arrow keys) to reorder; the full new order is saved in one call.
// Delete opens a confirm that states how many applications use the option and makes the user pick reassign or leave blank (FR-3.4).
export function OptionEditor({ column, open, onOpenChange, onCloseAutoFocus, onAdd, onUpdate, onReorder, onLoadImpact, onDelete }: {
  column: ColumnItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (e: Event) => void; // returns focus to the menu trigger that opened the editor
  onAdd: (label: string) => Promise<Result>;
  onUpdate: (optionId: number, patch: OptionPatch) => Promise<Result>;
  onReorder: (orderedIds: number[]) => Promise<Result>;
  onLoadImpact: (optionId: number) => Promise<OptionImpact>;
  onDelete: (optionId: number, choice: DeleteChoice) => Promise<Result>;
}) {
  // Also the DndContext id: without one dnd-kit numbers aria-describedby from a server-wide counter, so SSR and client ids differ.
  const uid = useId();
  // Shows the dropped order while the save runs; React drops it when the transition ends, so a failure reverts to the server order.
  const [options, setOrder] = useOptimistic(column.options, (cur, ids: number[]) =>
    ids.flatMap((id) => cur.filter((o) => o.id === id)), // skips an id that vanished while the save runs
  );
  const [reordering, startReorder] = useTransition();
  const [reorderError, setReorderError] = useState<string | null>(null);
  // The live region must sit inside the modal dialog: everything outside it is inert, so screen readers would skip it.
  const [liveContainer, setLiveContainer] = useState<HTMLElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const labelOf = (id: unknown) => options.find((o) => o.id === id)?.label ?? "option";
  const place = (id: unknown) => `position ${options.findIndex((o) => o.id === id) + 1} of ${options.length}`;
  const announcements = {
    onDragStart: ({ active }: { active: { id: unknown } }) => `Picked up ${labelOf(active.id)}, ${place(active.id)}.`,
    onDragOver: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
      over ? `${labelOf(active.id)} is over ${labelOf(over.id)}, ${place(over.id)}.` : `${labelOf(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
      over ? `Dropped ${labelOf(active.id)} at ${place(over.id)}.` : `Dropped ${labelOf(active.id)}; order unchanged.`,
    onDragCancel: ({ active }: { active: { id: unknown } }) => `Cancelled. ${labelOf(active.id)} stays where it was.`,
  };
  // dnd-kit cancels a keyboard drag on Escape; the dialog must not also close on that same keypress.
  const dragging = useRef(false);
  function onDragEnd({ active, over }: DragEndEvent) {
    dragging.current = false;
    if (reordering || !over || active.id === over.id) return; // one save at a time
    const ids = options.map((o) => o.id);
    const next = arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
    setReorderError(null);
    startReorder(async () => {
      setOrder(next);
      try {
        const r = await onReorder(next);
        if (!r.ok) setReorderError(r.error);
      } catch {
        setReorderError("Could not save the order. Try again.");
      }
    });
  }
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Delete confirm. The count is fetched fresh on every open; confirm stays disabled until it is shown and, if rows use the option, a choice is made.
  const [delOpen, setDelOpen] = useState(false);
  const back = useReturnFocus();
  const refocusNew = useRef(false); // after a delete the row's button is gone: focus goes to the new-option field
  const [deleting, setDeleting] = useState<OptionItem | null>(null);
  const [impact, setImpact] = useState<OptionImpact | null>(null); // null while loading
  const [choice, setChoice] = useState(""); // "" = nothing chosen, "blank", or an option id
  const [delError, setDelError] = useState<string | null>(null);
  const [deletingNow, startDelete] = useTransition();
  const [latest] = useState(createLatest); // a late count for an earlier option must not show for the one now open
  const others = deleting ? options.filter((o) => o.id !== deleting.id) : [];
  const lastStatus = column.isStatus && options.length === 1;
  const needsChoice = impact?.ok === true && impact.useCount > 0;
  function openDelete(o: OptionItem) {
    setDeleting(o);
    setImpact(null);
    setChoice("");
    setDelError(null);
    back.remember();
    setDelOpen(true);
    loadImpact(o.id);
  }
  function loadImpact(optionId: number) {
    const token = latest.start();
    onLoadImpact(optionId).then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not load the count. Try again." }),
    );
  }
  function confirmDelete() {
    if (!deleting || !impact?.ok) return;
    const expectedUseCount = impact.useCount;
    startDelete(async () => {
      try {
        const r = await onDelete(deleting.id, { confirm: true, reassignTo: choice === "" || choice === "blank" ? null : Number(choice), expectedUseCount });
        if (r.ok) {
          refocusNew.current = true;
          setDelOpen(false);
        } else {
          // Refused (e.g. the count changed meanwhile): show the fresh count and ask for the choice again before confirm re-enables.
          setDelError(r.error);
          setImpact(null);
          setChoice("");
          loadImpact(deleting.id);
        }
      } catch {
        setDelError("Could not delete. Try again.");
      }
    });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setLabel(""); setError(null); setReorderError(null); } onOpenChange(o); }}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(e) => {
          // First field, not the first drag handle: the first label, or "New option" when there are none.
          e.preventDefault();
          (document.getElementById(`${uid}-rows`)?.querySelector("input") ?? document.getElementById(`${uid}-new`))?.focus();
        }}
        onEscapeKeyDown={(e) => dragging.current && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Options: {column.name}</DialogTitle>
          <DialogDescription>Rename, recolour, reorder or delete options. Values follow their option.</DialogDescription>
        </DialogHeader>
        <div id={`${uid}-rows`} ref={setLiveContainer}>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">No options yet.</p>
          ) : (
            <DndContext
              id={`${uid}-dnd`}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => { dragging.current = true; }}
              onDragEnd={onDragEnd}
              onDragCancel={() => { dragging.current = false; }}
              accessibility={{ announcements, container: liveContainer ?? undefined }}
            >
              <SortableContext items={options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2">
                  {options.map((o) => (
                    <OptionRow key={`${o.id}-${o.label}-${o.color}`} option={o} locked={reordering} onSave={(patch) => onUpdate(o.id, patch)} onDelete={() => openDelete(o)} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
        {reorderError && <p role="alert" className="text-sm text-destructive">{reorderError}</p>}
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                const r = await onAdd(label);
                if (r.ok) setLabel("");
                setError(r.ok ? null : r.error);
              } catch {
                setError("Could not save. Try again.");
              }
            });
          }}
        >
          <Label htmlFor={`${uid}-new`}>New option</Label>
          <div className="flex gap-2">
            <Input id={`${uid}-new`} required maxLength={MAX_OPTION_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
          </div>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <ConfirmDialog
          open={delOpen}
          onOpenChange={setDelOpen}
          title="Delete option?"
          description={
            lastStatus ? (
              <span role="alert" className="text-destructive">The Status column needs at least one option, so <strong>{deleting?.label}</strong> cannot be deleted. Add another option first.</span>
            ) : impact === null ? (
              "Counting applications…"
            ) : !impact.ok ? (
              <span role="alert" className="text-destructive">{impact.error}</span>
            ) : impact.useCount === 0 ? (
              <>This permanently deletes the option <strong>{impact.label}</strong>. No applications use it.</>
            ) : (
              <>
                {plural(impact.useCount, "application")} use the option <strong>{impact.label}</strong>
                {impact.archivedCount > 0 ? `, including ${impact.archivedCount} archived` : ""}. Choose what happens to them. This cannot be undone.
              </>
            )
          }
          error={delError}
          confirmLabel="Delete option"
          busyLabel="Deleting…"
          confirmDisabled={lastStatus || !impact?.ok || (needsChoice && choice === "")}
          busy={deletingNow}
          onConfirm={confirmDelete}
          onCloseAutoFocus={(e) => {
            if (!refocusNew.current) return back.onCloseAutoFocus(e);
            refocusNew.current = false;
            e.preventDefault();
            document.getElementById(`${uid}-new`)?.focus();
          }}
        >
          {!lastStatus && needsChoice && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-choice`}>What should those applications get?</Label>
              <NativeSelect id={`${uid}-choice`} value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full">
                <NativeSelectOption value="">Choose…</NativeSelectOption>
                {others.map((o) => (
                  <NativeSelectOption key={o.id} value={String(o.id)}>Reassign to {o.label}</NativeSelectOption>
                ))}
                <NativeSelectOption value="blank">Leave blank (their {column.name} value is cleared)</NativeSelectOption>
              </NativeSelect>
            </div>
          )}
        </ConfirmDialog>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
