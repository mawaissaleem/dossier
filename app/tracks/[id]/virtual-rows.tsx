"use client";

import Link from "next/link";
import { Fragment, memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { safeHref } from "@/lib/cells";
import { editorKind, formatCell } from "@/lib/table";
import { spacers, withPinned } from "@/lib/virtual-rows";
import { cn } from "@/lib/utils";
import { CheckboxCell } from "./checkbox-cell";
import { EditableCell } from "./editable-cell";
import { RowPinContext } from "./row-pins";
import { SelectCell } from "./select-cell";

// 40px rows (h-10: a 32px control plus 4px padding, so entering edit mode never moves a row). Grid lines are border-b/border-r on each cell (border-separate keeps them on sticky cells).
const cell = "h-10 border-b border-r border-border px-2 py-1 align-middle";
const HEAD_H = 36; // h-9 header, sticky above the body
const ROW_H = 41; // measured: the h-10 cell plus its 1px line
const TABBABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const tabbables = (tr: Element) => [...tr.querySelectorAll<HTMLElement>(TABBABLE)];
const rowOf = (el: EventTarget) => (el as HTMLElement).closest<HTMLElement>("tr[data-id]");

// Stands in for the rows that are not mounted: one empty cell, so every browser honours the height.
const Gap = ({ height, span }: { height: number; span: number }) => <tr aria-hidden="true"><td colSpan={span} style={{ height }} className="p-0" /></tr>;

// One application row. Memoised: a scroll re-renders the window, but a row that stays in it is not rendered again.
const Row = memo(function Row({ row, index, columns, measure }: { row: ApplicationRow; index: number; columns: ColumnItem[]; measure: (el: HTMLTableRowElement | null) => void }) {
  return (
    <tr ref={measure} data-index={index} data-id={row.id} aria-rowindex={index + 2} className="group hover:bg-muted">
      <td className={cn(cell, "sticky left-0 z-10 bg-card group-hover:bg-muted")}>
        <Link href={`/applications/${row.id}`} title={row.title} className="block max-w-80 truncate rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{row.title}</Link>
      </td>
      {columns.map((col) => {
        const value = row.values[col.id];
        const label = `${col.name}, ${row.title}`;
        const kind = editorKind(col.type);
        return (
          <td key={col.id} className={cell}>
            {col.type === "checkbox" ? (
              <CheckboxCell applicationId={row.id} columnId={col.id} checked={value === true} label={label} />
            ) : col.type === "single_select" ? (
              <SelectCell applicationId={row.id} columnId={col.id} value={value} options={col.options} label={label} />
            ) : kind ? (
              <EditableCell applicationId={row.id} columnId={col.id} text={formatCell(col, value)} label={label} kind={kind} href={kind === "link" ? safeHref(formatCell(col, value)) : null} />
            ) : null}
          </td>
        );
      })}
      {/* under the "+" header cell, so the grid stays unbroken */}
      <td className={cell} />
    </tr>
  );
});

// The table body (task 4.5): only the rows near the viewport are mounted (TanStack Virtual), padded by empty rows so the scrollbar and the
// sticky header and Title column behave as with every row. Sorting and filtering still run on all rows (the parent). Rows that hold
// focus or an open editor stay mounted, keyed by application id, so scrolling never throws away what the user is doing.
// `box` is the scroll area as state, not a ref object: a child's layout effect runs before its ancestor's ref is attached, so a ref would still be null when the virtualizer first looks for it.
export function VirtualRows({ box, rows, columns }: { box: HTMLElement | null; rows: ApplicationRow[]; columns: ColumnItem[] }) {
  const [focusId, setFocusId] = useState<number | null>(null);
  const [editIds, setEditIds] = useState<number[]>([]); // ids with an open editor (EditableCell registers through RowPinContext)
  const [want, setWant] = useState<{ index: number; last: boolean } | null>(null); // Tab target outside the window, focused once it mounts
  const pin = useCallback((id: number) => {
    setEditIds((p) => [...p, id]);
    return () => setEditIds((p) => { const i = p.indexOf(id); return i < 0 ? p : p.filter((_, k) => k !== i); });
  }, []);
  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const pinned = [focusId, ...editIds].flatMap((id) => (id !== null && indexById.has(id) ? [indexById.get(id)!] : []));
  // eslint-disable-next-line react-hooks/incompatible-library -- no React Compiler in this project, and the virtualizer stays inside this component
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => box,
    estimateSize: () => ROW_H, // each mounted row is measured, so one grown by a save error is handled
    overscan: 8,
    scrollMargin: HEAD_H,
    scrollPaddingStart: HEAD_H,
    getItemKey: (i) => rows[i].id,
    rangeExtractor: (range) => withPinned(defaultRangeExtractor(range), pinned, range.count),
    initialRect: { width: 1200, height: 600 }, // so the server render and the first client render already have rows
  });
  const items = virt.getVirtualItems();
  const gaps = spacers(items, virt.getTotalSize(), HEAD_H);
  const span = columns.length + 2;

  useEffect(() => {
    if (!want) return;
    if (want.index >= rows.length) return setWant(null);
    const tr = box?.querySelector(`tr[data-index="${want.index}"]`);
    if (!tr) return; // not mounted yet: this runs again after the next render
    const f = tabbables(tr);
    (want.last ? f.at(-1) : f[0])?.focus();
    setWant(null);
  }, [want, rows.length, items, box]);

  // Tab past the last control of the last mounted row (or Shift+Tab before the first) would leave the table: go to the neighbouring row instead.
  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    const tr = rowOf(e.target);
    if (!tr) return;
    const f = tabbables(tr);
    if ((e.shiftKey ? f[0] : f.at(-1)) !== e.target) return;
    const j = Number(tr.dataset.index) + (e.shiftKey ? -1 : 1);
    if (j < 0 || j >= rows.length) return; // the real first or last row: leave the table
    if ((e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling)?.getAttribute("data-index") === String(j)) return; // mounted: native Tab does it
    e.preventDefault();
    virt.scrollToIndex(j);
    setWant({ index: j, last: e.shiftKey });
  }

  return (
    <RowPinContext value={pin}>
      <tbody
        onFocus={(e) => setFocusId(Number(rowOf(e.target)?.dataset.id) || null)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusId(null); }}
        onKeyDown={onKeyDown}
      >
        {items.map((item, n) => (
          <Fragment key={rows[item.index].id}>
            {gaps.before[n] > 0 && <Gap height={gaps.before[n]} span={span} />}
            <Row row={rows[item.index]} index={item.index} columns={columns} measure={virt.measureElement} />
          </Fragment>
        ))}
        {gaps.after > 0 && <Gap height={gaps.after} span={span} />}
      </tbody>
    </RowPinContext>
  );
}
