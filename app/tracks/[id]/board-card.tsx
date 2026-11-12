"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CalendarIcon, CircleAlertIcon, MoveHorizontalIcon } from "lucide-react";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { deadlineInfo, localToday } from "@/lib/deadline";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OptionChip } from "@/app/option-chip";

const subscribe = () => () => {};
// The visitor's local day. The server cannot know it, so the server snapshot is null (date only, no hint) and the browser fills the hint in
// after hydration: no mismatch and no UTC-day drift. It is read once per mount, so a tab left open past midnight updates on the next render.
const useToday = () => useSyncExternalStore(subscribe, () => localToday(), () => null);

export const CARD_BOX = "flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";

// What a card shows: title (2 lines at most), then Priority as its option chip and the Deadline with a relative hint. A missing column or a blank
// value leaves that line out. Overdue is by date only (any status) and shown with an icon, the word "Overdue" and the destructive token.
// Used by the card in its column and by the drag overlay, so they look the same.
export function CardFace({ row, priority, deadline }: { row: ApplicationRow; priority?: ColumnItem; deadline?: ColumnItem }) {
  const today = useToday();
  const pv = priority ? row.values[priority.id] : null;
  const option = priority?.options.find((o) => o.id === pv);
  const due = deadline ? deadlineInfo(row.values[deadline.id], today) : null;
  return (
    <>
      <span className="line-clamp-2 break-words font-medium">{row.title}</span>
      {(option || due) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {option && <span><span className="sr-only">Priority: </span><OptionChip option={option} /></span>}
          {due && (
            <time dateTime={String(row.values[deadline!.id])} className={`flex items-center gap-1 text-xs tabular-nums ${due.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
              {due.overdue ? <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" /> : <CalendarIcon aria-hidden className="size-3.5 shrink-0" />}
              <span><span className="sr-only">Deadline: </span>{due.overdue && "Overdue · "}{due.date}{due.relative && ` · ${due.relative}`}</span>
            </time>
          )}
        </span>
      )}
    </>
  );
}

// One card: a link to the detail page that is also the drag handle (mouse after 6px, touch after a 250 ms hold, keyboard Space; Enter still opens the
// card), plus a "Move to" select, the non-drag way to change the status (WCAG 2.5.7). The select is a sibling of the link, never inside it.
// `current` is the option id of the column the card is in (null = No status).
export function BoardCard({ row, priority, deadline, current, targets, onMove }: {
  row: ApplicationRow; priority?: ColumnItem; deadline?: ColumnItem; current: number | null;
  targets: { optionId: number | null; label: string }[]; onMove: (rowId: number, to: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: row.id });
  return (
    <li ref={setNodeRef} className={`relative ${isDragging ? "opacity-40" : ""}`}>
      <Link
        ref={setActivatorNodeRef}
        href={`/applications/${row.id}`}
        draggable={false} // the browser's own link drag would cancel the pointer drag
        title={row.title}
        data-card={row.id}
        aria-describedby={attributes["aria-describedby"]}
        aria-roledescription="draggable card"
        {...listeners}
        className={`${CARD_BOX} select-none pr-9 outline-none transition-colors [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <CardFace row={row} priority={priority} deadline={deadline} />
      </Link>
      <div className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-ring">
        <MoveHorizontalIcon aria-hidden className="size-4" />
        <NativeSelect
          aria-label={`Move ${row.title} to`}
          value={current === null ? "" : String(current)}
          onChange={(e) => onMove(row.id, e.target.value === "" ? null : Number(e.target.value))}
          className="absolute inset-0 w-full [&>select]:h-full [&>select]:p-0 [&>select]:cursor-pointer [&>select]:opacity-0 [&>svg]:hidden"
        >
          {targets.map((t) => <NativeSelectOption key={t.optionId ?? ""} value={t.optionId ?? ""}>{t.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
    </li>
  );
}
