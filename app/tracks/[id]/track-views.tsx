"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { filterRows, parseFilters, withFilters, type Filter } from "@/lib/filter";
import { quickColumns } from "@/lib/quick-filter";
import { cn } from "@/lib/utils";
import { setColumnHidden } from "@/app/actions/columns";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ApplicationsTable } from "./applications-table";
import { Board } from "./board";
import { HiddenColumns } from "./column-menu";
import { FilterBar } from "./filter-bar";
import { QuickFilters } from "./quick-filters";

const VIEWS = [{ id: "table", label: "Table" }, { id: "board", label: "Board" }] as const;

// Table or Board of one track. The view is ?view=board (anything else is the table); other params are kept, so going back to the table restores them.
// The filters (?f, lib/filter.ts) are one state for both views (FR-4.3): read and written here, applied to the rows before either view sees them, and set with
// the same FilterBar and QuickFilters above both. ?sort and ?dir are table-only: kept in the URL, ignored by the board. There is no text search here; search is the Ctrl+K palette.
// pushState (synced with useSearchParams by Next) makes each switch a history entry, so Back returns to the previous view, and keeps the switch instant.
export function TrackViews({ trackId, columns, rows }: { trackId: number; columns: ColumnItem[]; rows: ApplicationRow[] }) {
  const params = useSearchParams();
  const view = params.get("view") === "board" ? "board" : "table";
  // Filters live in the URL, may use hidden columns, and run on the rows the server sent. Keyed on the f params as a string, so sorting does not re-filter.
  const selects = useMemo(() => columns.filter((c) => c.type === "single_select"), [columns]);
  const quick = useMemo(() => quickColumns(selects), [selects]);
  const hidden = columns.filter((c) => c.hidden);
  const fKey = params.getAll("f").join("\n");
  const filters = useMemo(() => parseFilters(fKey ? fKey.split("\n") : [], selects), [fKey, selects]);
  const filtered = useMemo(() => filterRows(rows, selects, filters), [rows, selects, filters]);
  // replaceState (synced with useSearchParams by Next) keeps the click instant: no server round trip, no history entry per click.
  const setFilters = (f: Filter[]) => { const q = withFilters(params.toString(), f); window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname); };
  const show = (id: string) => {
    const q = new URLSearchParams(params.toString());
    if (id === "board") q.set("view", "board"); else q.delete("view");
    window.history.pushState(null, "", q.size ? `?${q}` : window.location.pathname);
  };
  return (
    <>
      <div role="group" aria-label="View" className="mb-3 inline-flex rounded-md border border-input bg-card p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => view !== v.id && show(v.id)}
            className={cn(
              "h-7 rounded-sm px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              view === v.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <FilterBar
        columns={selects}
        filters={filters}
        onChange={setFilters}
        shown={filtered.length}
        total={rows.length}
        trailing={view === "table" && hidden.length > 0 && <HiddenColumns columns={hidden} onShow={(id) => setColumnHidden(trackId, id, false)} />}
      />
      {quick.length > 0 && <QuickFilters quick={quick} columns={selects} rows={rows} filters={filters} onChange={setFilters} />}
      {view === "board"
        ? <Board columns={columns} rows={rows} selects={selects} filters={filters} />
        : <ApplicationsTable trackId={trackId} columns={columns} rows={filtered} />}
      {rows.length === 0 && <EmptyState title="No applications yet" description="Add one with a title in the form above." className="mt-4" />}
      {rows.length > 0 && filtered.length === 0 && (
        <EmptyState title="No applications match these filters" description="Change a filter or clear them to see all applications." className="mt-4">
          <Button type="button" variant="outline" size="sm" onClick={() => setFilters([])}>Clear filters</Button>
        </EmptyState>
      )}
    </>
  );
}
