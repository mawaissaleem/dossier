"use client";

import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ColumnItem, OptionItem } from "@/lib/db/columns";
import { PALETTE, chipClasses } from "@/lib/colors";
import { MAX_OPTION_LABEL } from "@/lib/options";

type Result = { ok: true } | { ok: false; error: string };
export type OptionPatch = { label: string; color: string };
export type OptionImpact = { ok: true; label: string; useCount: number; archivedCount: number } | { ok: false; error: string };
export type DeleteChoice = { confirm: true; reassignTo: number | null };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// One option: label input + colour select (palette tokens only) + Save. The chip previews the draft.
// The parent keys the row by id+label+color, so after a save the draft resets to the stored values.
function OptionRow({ option, locked, onSave, onDelete }: { option: OptionItem; locked: boolean; onSave: (patch: OptionPatch) => Promise<Result>; onDelete: () => void }) {
  const [label, setLabel] = useState(option.label);
  const [color, setColor] = useState(option.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: option.id, disabled: locked });
  // No native `disabled` while saving: a disabled button drops focus to <body>; useSortable sets aria-disabled and ignores input.
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "relative z-10 bg-background" : undefined}>
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
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder option ${option.label}`} className="cursor-grab touch-none rounded border border-foreground/30 px-2 py-1 aria-disabled:opacity-50">⠿</button>
        <span className={`inline-block rounded-full px-2 py-0.5 text-sm ${chipClasses(color)}`} aria-hidden="true">{label.trim() || "…"}</span>
        <input aria-label={`Label of option ${option.label}`} required maxLength={MAX_OPTION_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} className="rounded border border-foreground/30 px-2 py-1" />
        <select aria-label={`Colour of option ${option.label}`} value={color} onChange={(e) => setColor(e.target.value)} className="rounded border border-foreground/30 px-1 py-1">
          {PALETTE.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button type="submit" disabled={pending} aria-label={`Save option ${option.label}`} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
        <button type="button" disabled={locked} onClick={onDelete} aria-label={`Delete option ${option.label}`} className="rounded border border-foreground/30 px-3 py-1 text-red-600 disabled:opacity-50">Delete…</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </li>
  );
}

// Dialog listing a single-select column's options in position order, with add / rename / recolour. Values keep following
// their option (FR-3.3). Drag the handle (or Space/Enter then arrow keys) to reorder; the full new order is saved in one call.
// Delete opens a confirm that states how many applications use the option and makes the user pick reassign or leave blank (FR-3.4).
export function OptionEditor({ column, innerRef, onAdd, onUpdate, onReorder, onLoadImpact, onDelete }: {
  column: ColumnItem;
  innerRef: React.RefObject<HTMLDialogElement | null>;
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
  function onDragEnd({ active, over }: DragEndEvent) {
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
  const delDialog = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState<OptionItem | null>(null);
  const [impact, setImpact] = useState<OptionImpact | null>(null); // null while loading
  const [choice, setChoice] = useState(""); // "" = nothing chosen, "blank", or an option id
  const [delError, setDelError] = useState<string | null>(null);
  const [deletingNow, startDelete] = useTransition();
  const others = deleting ? options.filter((o) => o.id !== deleting.id) : [];
  const lastStatus = column.isStatus && options.length === 1;
  const needsChoice = impact?.ok === true && impact.useCount > 0;
  function openDelete(o: OptionItem) {
    setDeleting(o);
    setImpact(null);
    setChoice("");
    setDelError(null);
    delDialog.current?.showModal();
    onLoadImpact(o.id).then(setImpact, () => setImpact({ ok: false, error: "Could not load the count. Try again." }));
  }
  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      try {
        const r = await onDelete(deleting.id, { confirm: true, reassignTo: choice === "" || choice === "blank" ? null : Number(choice) });
        if (r.ok) {
          delDialog.current?.close();
          document.getElementById(`${uid}-new`)?.focus(); // the deleted row's button is going away
        } else setDelError(r.error);
      } catch {
        setDelError("Could not delete. Try again.");
      }
    });
  }
  return (
    <dialog ref={innerRef} aria-labelledby={`${uid}-title`} className="m-auto max-w-xl rounded border border-foreground/30 bg-background p-4 text-left text-base font-normal text-foreground">
      <h2 id={`${uid}-title`} className="mb-2 text-lg font-semibold">Options: {column.name}</h2>
      <div ref={setLiveContainer}>
        {options.length === 0 ? (
          <p className="text-sm text-foreground/70">No options yet.</p>
        ) : (
          <DndContext id={`${uid}-dnd`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements, container: liveContainer ?? undefined }}>
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
      {reorderError && <p role="alert" className="text-sm text-red-600">{reorderError}</p>}
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
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
        <label htmlFor={`${uid}-new`} className="text-sm">New option</label>
        <input id={`${uid}-new`} required maxLength={MAX_OPTION_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} className="rounded border border-foreground/30 px-2 py-1" />
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">{pending ? "Adding…" : "Add"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <dialog
        ref={delDialog}
        aria-labelledby={`${uid}-del-title`}
        onCancel={(e) => deletingNow && e.preventDefault()}
        className="m-auto max-w-md rounded border border-foreground/30 bg-background p-4 text-left text-base font-normal text-foreground"
      >
        <h2 id={`${uid}-del-title`} className="mb-2 text-lg font-semibold">Delete option?</h2>
        {lastStatus ? (
          <p role="alert" className="text-red-600">The Status column needs at least one option, so <strong>{deleting?.label}</strong> cannot be deleted. Add another option first.</p>
        ) : impact === null ? (
          <p>Counting applications…</p>
        ) : !impact.ok ? (
          <p role="alert" className="text-red-600">{impact.error}</p>
        ) : impact.useCount === 0 ? (
          <p>This permanently deletes the option <strong>{impact.label}</strong>. No applications use it.</p>
        ) : (
          <>
            <p>
              {plural(impact.useCount, "application")} use the option <strong>{impact.label}</strong>
              {impact.archivedCount > 0 ? `, including ${impact.archivedCount} archived` : ""}. Choose what happens to them. This cannot be undone.
            </p>
            <label htmlFor={`${uid}-choice`} className="mt-2 block text-sm">What should those applications get?</label>
            <select id={`${uid}-choice`} value={choice} onChange={(e) => setChoice(e.target.value)} className="rounded border border-foreground/30 px-2 py-1">
              <option value="">Choose…</option>
              {others.map((o) => (
                <option key={o.id} value={String(o.id)}>Reassign to {o.label}</option>
              ))}
              <option value="blank">Leave blank (their {column.name} value is cleared)</option>
            </select>
          </>
        )}
        {delError && <p role="alert" className="mt-2 text-sm text-red-600">{delError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => delDialog.current?.close()} disabled={deletingNow} className="rounded border border-foreground/30 px-3 py-1 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            disabled={deletingNow || lastStatus || !impact?.ok || (needsChoice && choice === "")}
            onClick={confirmDelete}
            className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50"
          >
            {deletingNow ? "Deleting…" : "Delete option"}
          </button>
        </div>
      </dialog>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => innerRef.current?.close()} className="rounded border border-foreground/30 px-3 py-1">Close</button>
      </div>
    </dialog>
  );
}
