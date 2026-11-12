"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DroppableContainer, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { updateCell } from "@/app/actions/cells";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { applyMove, boardGroups, cardColumns, columnAtX, columnFilteredOut, columnLabel, hiddenAfterMove, nextColumn, planMove, NO_STATUS, type BoardColumn, type Move } from "@/lib/board";
import { EmptyState } from "@/components/empty-state";
import { OptionChip } from "@/app/option-chip";
import { useSubmissionReview } from "@/app/submission-review";
import type { Filter } from "@/lib/filter";
import { BoardCard, CARD_BOX, CardFace } from "./board-card";

const INSTRUCTIONS =
  "To move this card, press Space to pick it up, the left or right arrow key to choose a status, then Space to drop it or Escape to cancel. Press Enter to open the card instead. The Move to menu on the card does the same.";

// Mouse: a pointer must travel 6px, so a click still opens the card. Touch: a 250 ms hold (a quicker swipe scrolls the board). Keyboard: Space.
// Mouse and touch are two sensors, not PointerSensor, so the touch hold works. Enter is left to the link (it opens the card).
const keyboardCodes = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

// The enabled columns with their measured rects, for the pure geometry in lib/board.
const spans = (containers: DroppableContainer[], rects: Parameters<CollisionDetection>[0]["droppableRects"]) =>
  containers.flatMap((c) => { const r = rects.get(c.id); return r ? [{ id: c.id, left: r.left, width: r.width, top: r.top }] : []; });

// Left and right arrows jump to the next column (the default 25px step would take about twelve presses per column); other keys do nothing.
const columnCoordinates: KeyboardCoordinateGetter = (event, { context: { active, collisionRect, droppableRects, droppableContainers } }) => {
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  if (!dir || !active || !collisionRect) return;
  event.preventDefault();
  const t = nextColumn(collisionRect.left + collisionRect.width / 2, dir, spans(droppableContainers.getEnabled(), droppableRects));
  return t && { x: t.left + (t.width - collisionRect.width) / 2, y: t.top + 8 };
};

// The pointer decides for the mouse and touch (a card over the gap between columns is over nothing); the keyboard has no pointer, so the column
// the card is in horizontally (columnAtX; not closestCenter, which picks a short neighbour of a tall column).
const collision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) return pointerWithin(args);
  const c = columnAtX(args.collisionRect.left + args.collisionRect.width / 2, spans(args.droppableContainers, args.droppableRects));
  return c ? [{ id: c.id }] : [];
};

// Board view (FR-4.2): one column per status option, the same rows as the table. The board scrolls sideways inside its own area and each column
// scrolls up and down, so the page never scrolls sideways. Every card is mounted: 500 cards is a few thousand light nodes, so no virtualisation.
// `rows` are all the track's rows and `filters` the shared ?f state: the board filters them itself (after any pending move), so a card dropped into a
// status the filters hide leaves the board at once. A column the status filter leaves out stays, empty, so it is still a drop target.
type Props = { columns: ColumnItem[]; rows: ApplicationRow[]; selects: ColumnItem[]; filters: Filter[] };
export function Board({ columns, rows, selects, filters }: Props) {
  const status = columns.find((c) => c.isStatus);
  if (!status) {
    return <EmptyState title="This track has no status column" description="The board groups applications by status. In the table view, open a single-select column's menu and choose “Use as status column”." />;
  }
  return <StatusBoard columns={columns} rows={rows} selects={selects} filters={filters} status={status} />;
}

function StatusBoard({ columns, rows, selects, filters, status }: Props & { status: ColumnItem }) {
  const uid = useId(); // also the DndContext id: without one dnd-kit numbers aria-describedby from a counter that differs between server and client
  // The card the user just moved, shown in its new column while the save (or the submission review) runs. Dropped to roll back.
  const [move, setMove] = useState<Move | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const [hiddenNote, setHiddenNote] = useState(false); // the last move left the board: show the note, not only announce it
  const note = useRef<HTMLParagraphElement>(null);
  const [, startTransition] = useTransition();
  const locked = useRef(false); // set synchronously: a second drop can land before a re-render
  const root = useRef<HTMLDivElement>(null);
  const focusCard = useRef<number | null>(null); // the card to put focus back on once it has rendered in its column
  const cardEl = (id: number | null) => (id === null ? null : root.current?.querySelector<HTMLElement>(`[data-card="${id}"]`) ?? null);
  // Where the review dialog returns focus when the card it remembered is gone (a cancelled move re-creates the card in its old column).
  const [fallback] = useState(() => ({ get current() { return cardEl(focusCard.current); } }));
  const { review, dialog } = useSubmissionReview(fallback);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes, coordinateGetter: columnCoordinates }),
  );
  // Once the rows no longer hold the value the move started from (saved and refreshed, or changed elsewhere), forget it, so it cannot come back
  // if the row later returns to that value. Set during render (React's adjust-state-on-prop-change pattern), not in an effect.
  if (move && (rows.find((r) => r.id === move.rowId)?.values[status.id] ?? null) !== move.from) setMove(null);
  const shown = useMemo(() => applyMove(rows, status.id, move), [rows, status.id, move]);
  const groups = useMemo(() => boardGroups(shown, selects, filters, status), [shown, selects, filters, status]);
  const { priority, deadline } = useMemo(() => cardColumns(columns), [columns]);
  const targets = useMemo(() => [...status.options.map((o) => ({ optionId: o.id as number | null, label: o.label })), { optionId: null, label: NO_STATUS }], [status.options]);

  useEffect(() => {
    if (focusCard.current !== null) cardEl(focusCard.current)?.focus();
    focusCard.current = null;
  });
  // The moved card is gone, and so is the focus that was on it: put it on the note, which says where the card went.
  useEffect(() => { if (hiddenNote) note.current?.focus(); }, [hiddenNote, done]);

  // The one status-change path: the same updateCell and review dialog as the table's select (FR-7.2, 7.3), never a separate save.
  function go(plan: Move | null) {
    if (!plan || locked.current) return; // a drop while a save is in flight is ignored and the card stays where it is
    locked.current = true;
    const row = rows.find((r) => r.id === plan.rowId);
    const title = row?.title ?? "the application";
    const label = targets.find((t) => t.optionId === plan.to)?.label ?? NO_STATUS;
    const put = (m: Move | null) => { focusCard.current = plan.rowId; setMove(m); };
    const gone = !!row && hiddenAfterMove(row, selects, filters, status.id, plan);
    const moved = () => { setDone(`Moved ${title} to ${label}${gone ? " (hidden by filters)" : ""}.`); setHiddenNote(gone); };
    setError(null);
    setDone("");
    setHiddenNote(false);
    put(plan);
    startTransition(async () => {
      try {
        const r = await updateCell(plan.rowId, status.id, plan.to);
        if (r.ok) moved();
        else if (r.needsReview && plan.to !== null) review({ applicationId: plan.rowId, columnId: status.id, optionId: plan.to, statusLabel: label, onSaved: moved, onCancel: () => put(null) });
        else { put(null); setError(`Could not move ${title}: ${r.error}`); }
      } catch {
        put(null);
        setError(`Could not move ${title}. Try again.`);
      } finally {
        locked.current = false;
      }
    });
  }

  const title = (id: unknown) => rows.find((r) => r.id === Number(id))?.title ?? "card";
  const column = (id: unknown) => groups.find((g) => g.key === id)?.label ?? "no status";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${title(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${title(active.id)} is over ${column(over.id)}.` : `${title(active.id)} is not over a status.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${title(active.id)} on ${column(over.id)}.` : `Dropped ${title(active.id)}. Status unchanged.`),
    onDragCancel: ({ active }) => `Cancelled. ${title(active.id)} stays where it was.`,
  };
  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    const target = groups.find((g) => g.key === over?.id);
    if (target) go(planMove(groups, status.id, Number(active.id), target.optionId));
  }

  const source = groups.find((g) => g.cards.some((c) => c.id === draggingId))?.key;
  const dragged = draggingId === null ? undefined : shown.find((r) => r.id === draggingId);
  return (
    <>
      {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
      <p ref={note} role="status" tabIndex={-1} className={hiddenNote ? "mb-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" : "sr-only"}>{done}</p>
      <DndContext
        id={uid}
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
        onDragStart={({ active }) => setDraggingId(Number(active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div ref={root} className="flex items-start gap-3 overflow-x-auto rounded-lg pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {groups.map((g) => (
            <Column key={g.key} group={g} out={columnFilteredOut(filters, status.id, g.optionId)} highlight={draggingId !== null && g.key !== source}>
              {g.cards.map((r) => (
                <BoardCard key={r.id} row={r} priority={priority} deadline={deadline} current={g.optionId} targets={targets} onMove={(id, to) => go(planMove(groups, status.id, id, to))} />
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragged && <div className={`${CARD_BOX} shadow-lg`}><CardFace row={dragged} priority={priority} deadline={deadline} /></div>}
        </DragOverlay>
      </DndContext>
      {dialog}
    </>
  );
}

// A drop target. While a card is being dragged, every other column can take it; the one under the pointer gets the accent ring and a layer step.
function Column({ group: g, out, highlight, children }: { group: BoardColumn; out: boolean; highlight: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: g.key });
  return (
    <section
      ref={setNodeRef}
      aria-label={columnLabel(g.label, g.cards.length)}
      className={`flex max-h-[75vh] w-72 shrink-0 flex-col rounded-lg border bg-background ${isOver && highlight ? "border-accent bg-muted ring-2 ring-accent" : "border-border"}`}
    >
      <header className="flex items-center gap-2 border-b border-border p-2">
        <OptionChip option={g} />
        <span className="text-xs tabular-nums text-muted-foreground">{g.cards.length}</span>
      </header>
      {g.cards.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">{out ? "Hidden by filters" : "No applications"}</p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto p-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{children}</ul>
      )}
    </section>
  );
}
