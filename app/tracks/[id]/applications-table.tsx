"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTable } from "@tanstack/react-table";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { columnId } from "@/lib/column-id";
import { buildColumns, features, getRowId } from "@/lib/table";
import { filterRows, parseFilters, withFilters, type Filter } from "@/lib/filter";
import { nextSort, parseSort, sortRows, withSort, type Sort } from "@/lib/sort";
import { addColumn, deleteColumn, fetchColumnDeleteImpact, moveColumn, renameColumn, setColumnHidden, setStatusColumn, setColumnDefault } from "@/app/actions/columns";
import { addOption, deleteOption, fetchOptionDeleteImpact, reorderOptions, updateOption } from "@/app/actions/options";
import { AddColumnDialog } from "./add-column-dialog";
import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, ChevronsUpDownIcon, HashIcon, LinkIcon, SquareCheckIcon, TypeIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { ColumnType } from "@/lib/db/schema";
import { ColumnMenu, HiddenColumns } from "./column-menu";
import { FilterBar } from "./filter-bar";
import { QuickFilters } from "./quick-filters";
import { quickColumns } from "@/lib/quick-filter";
import { columnWidth } from "@/lib/virtual-rows";
import { VirtualRows } from "./virtual-rows";
import { Button } from "@/components/ui/button";

const TYPE_ICONS: Record<ColumnType, typeof TypeIcon> = { text: TypeIcon, number: HashIcon, date: CalendarIcon, link: LinkIcon, checkbox: SquareCheckIcon, single_select: ChevronsUpDownIcon };
const headCell = "sticky top-0 z-20 h-9 border-b border-r border-border bg-card px-2 text-left text-xs font-medium text-muted-foreground";

// Props are plain data from the server page. The body only mounts the rows near the viewport (virtual-rows.tsx, task 4.5); sort and filter still run on all rows here.
export function ApplicationsTable({ trackId, columns, rows }: { trackId: number; columns: ColumnItem[]; rows: ApplicationRow[] }) {
  const defs = useMemo(() => buildColumns(columns), [columns]);
  const byId = useMemo(() => new Map(columns.map((c) => [columnId(c), c])), [columns]);
  const visible = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const hidden = columns.filter((c) => c.hidden);
  // Sort lives in the URL (?sort=col-3&dir=asc) and runs here on the rows the server sent; a hidden or unknown column means default order.
  const params = useSearchParams();
  const sort = useMemo(() => parseSort(params.get("sort"), params.get("dir"), visible), [params, visible]);
  // Filters live in the URL too (?f=<columnId>:<optId>.<optId>&f=..., see lib/filter.ts), may use hidden columns, and run before the sort.
  // Keyed on the f params as a string, so sorting does not re-filter.
  const selects = useMemo(() => columns.filter((c) => c.type === "single_select"), [columns]);
  const quick = useMemo(() => quickColumns(selects), [selects]);
  const fKey = params.getAll("f").join("\n");
  const filters = useMemo(() => parseFilters(fKey ? fKey.split("\n") : [], selects), [fKey, selects]);
  const filtered = useMemo(() => filterRows(rows, selects, filters), [rows, selects, filters]);
  const sorted = useMemo(() => sortRows(filtered, visible, sort), [filtered, visible, sort]);
  // replaceState (synced with useSearchParams by Next) keeps the click instant: no server round trip, no history entry per click.
  const setQuery = (q: string) => window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
  const setSort = (s: Sort | null) => setQuery(withSort(params.toString(), s));
  const setFilters = (f: Filter[]) => setQuery(withFilters(params.toString(), f));
  const table = useTable({ features, columns: defs, data: sorted, getRowId });
  const [box, setBox] = useState<HTMLDivElement | null>(null); // the scroll area, which the body's virtualizer watches
  const widths = [columnWidth("title"), ...visible.map((c) => columnWidth(c.type)), columnWidth("add")];

  return (
    <>
    <FilterBar
      columns={selects}
      filters={filters}
      onChange={setFilters}
      shown={sorted.length}
      total={rows.length}
      trailing={hidden.length > 0 && <HiddenColumns columns={hidden} onShow={(id) => setColumnHidden(trackId, id, false)} />}
    />
    {quick.length > 0 && <QuickFilters quick={quick} columns={selects} rows={rows} filters={filters} onChange={setFilters} />}
    {/* The table scrolls inside its own area (both ways, so the sticky header and Title column work); the page never scrolls sideways. */}
    <div ref={setBox} className="max-h-[75vh] scroll-pt-10 overflow-auto rounded-lg border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {/* Fixed layout with a colgroup: widths do not depend on which rows are mounted. Rows are 1-based in ARIA and the header is row 1. */}
    <table aria-rowcount={sorted.length + 1} style={{ minWidth: widths.reduce((a, b) => a + b, 0) }} className="w-full table-fixed border-separate border-spacing-0 text-left text-sm tabular-nums [&_tr>:last-child]:border-r-0 [&_tbody>tr:last-child>td]:border-b-0">
      <colgroup>
        {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
      </colgroup>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} aria-rowindex={1}>
            {group.headers.map((header) => {
              const col = byId.get(header.column.id); // undefined for Title: no menu
              const Icon = col && TYPE_ICONS[col.type];
              const dir = sort?.id === header.column.id ? sort.dir : null;
              const DirIcon = dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
              return (
                <th key={header.id} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined} className={cn(headCell, !col && "left-0 z-30")}>
                  <div className="flex items-center gap-x-1.5 whitespace-nowrap">
                    {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                    <span className={cn("min-w-0 flex-1", col?.type === "number" && "text-right")}>
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={() => setSort(nextSort(sort, header.column.id))}
                          title={col?.name ?? "Title"}
                          className={cn("inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", dir && "text-foreground")}
                        >
                          <span className="truncate"><table.FlexRender header={header} /></span>
                          {dir && <DirIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                        </button>
                      )}
                    </span>
                    {col?.isStatus && <span className="shrink-0 rounded-sm bg-muted px-1.5 text-xs font-medium text-foreground">Status</span>}
                    {col && (
                      <ColumnMenu
                        column={col}
                        first={visible[0]?.id === col.id}
                        last={visible.at(-1)?.id === col.id}
                        onRename={(name) => renameColumn(trackId, col.id, name)}
                        onHide={async () => {
                          const r = await setColumnHidden(trackId, col.id, true);
                          if (r.ok && sort?.id === header.column.id) setSort(null); // a hidden column cannot be sorted by, so do not leave a stale ?sort=
                          return r;
                        }}
                        onMove={(dir) => moveColumn(trackId, col.id, dir)}
                        onLoadImpact={() => fetchColumnDeleteImpact(col.id)}
                        onDelete={(expected) => deleteColumn(col.id, true, expected)}
                        onAddOption={(label) => addOption(col.id, label)}
                        onUpdateOption={(optionId, patch) => updateOption(col.id, optionId, patch)}
                        onReorderOptions={(ids) => reorderOptions(col.id, ids)}
                        onLoadOptionImpact={fetchOptionDeleteImpact}
                        onDeleteOption={deleteOption}
                        onSetStatus={() => setStatusColumn(trackId, col.id)}
                        onSetDefault={(value) => setColumnDefault(col.id, value)}
                      />
                    )}
                  </div>
                </th>
              );
            })}
            <th className={cn(headCell, "w-10")}>
              <AddColumnDialog onSubmit={(name, type) => addColumn(trackId, name, type)} />
            </th>
          </tr>
        ))}
      </thead>
      <VirtualRows box={box} rows={sorted} columns={visible} />
    </table>
    </div>
    {rows.length === 0 && <EmptyState title="No applications yet" description="Add one with a title in the form above." className="mt-4" />}
    {rows.length > 0 && sorted.length === 0 && (
      <EmptyState title="No applications match these filters" description="Change a filter or clear them to see all applications." className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={() => setFilters([])}>Clear filters</Button>
      </EmptyState>
    )}
    </>
  );
}
