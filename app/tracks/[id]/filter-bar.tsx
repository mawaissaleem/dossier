"use client";

import { useRef } from "react";
import { FilterIcon, XIcon } from "lucide-react";
import { OptionChip } from "@/app/option-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnItem } from "@/lib/db/columns";
import { toggleFilter, type Filter, type Token } from "@/lib/filter";

const chipText = (col: ColumnItem, f: Filter) =>
  [...col.options.filter((o) => f.options.includes(o.id)).map((o) => o.label), ...(f.blank ? ["(Blank)"] : [])].join(", ");

// The ticks for one column: its options, then "(Blank)". onSelect keeps the menu open so several can be ticked in a row.
function OptionChecks({ col, filter, onToggle }: { col: ColumnItem; filter: Filter | undefined; onToggle: (t: Token) => void }) {
  const keepOpen = (e: Event) => e.preventDefault();
  return (
    <>
      {col.options.map((o) => (
        <DropdownMenuCheckboxItem key={o.id} checked={filter?.options.includes(o.id) ?? false} onCheckedChange={() => onToggle(o.id)} onSelect={keepOpen}>
          <OptionChip option={o} />
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuCheckboxItem checked={filter?.blank ?? false} onCheckedChange={() => onToggle("blank")} onSelect={keepOpen}>
        (Blank)
      </DropdownMenuCheckboxItem>
    </>
  );
}

// "Filter" menu (one submenu per single-select column, hidden ones marked), the active filters as chips, "Clear all" and the count.
// Chips: the label opens the same ticks to edit; the x removes. `trailing` is the hidden-columns control, kept on the right.
export function FilterBar({ columns, filters, onChange, shown, total, trailing }: {
  columns: ColumnItem[]; // the track's single-select columns, hidden ones included
  filters: Filter[];
  onChange: (next: Filter[]) => void;
  shown: number;
  total: number;
  trailing?: React.ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);

  // Before a chip goes away, move focus to a neighbour that stays mounted: the next chip, else the previous one, else the Filter button (index 0).
  // `later`: the chip's own menu is closing with it, and Radix hands focus back to the removed trigger on a 0ms timeout, so wait that out.
  const focusAround = (id: number | null, later = false) => {
    const stops = [...(bar.current?.querySelectorAll<HTMLElement>("[data-filter-stop]") ?? [])];
    const i = id === null ? -1 : stops.findIndex((e) => e.dataset.filterStop === String(id));
    const target = stops[i + 1] ?? stops[Math.max(i - 1, 0)];
    if (later) setTimeout(() => target?.focus(), 50);
    else target?.focus();
  };
  const remove = (id: number) => {
    focusAround(id);
    onChange(filters.filter((f) => f.id !== id));
  };
  // Unticking the last option inside a chip's own menu removes the chip and the menu with it.
  const toggleInChip = (id: number, t: Token) => {
    const next = toggleFilter(filters, id, t);
    if (!next.some((f) => f.id === id)) focusAround(id, true);
    onChange(next);
  };

  return (
    <div ref={bar} className="mb-2 flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" data-filter-stop="menu">
            <FilterIcon aria-hidden="true" />
            Filter
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-auto min-w-48">
          {columns.length === 0 && <DropdownMenuItem disabled>No single-select columns</DropdownMenuItem>}
          {columns.map((c) => (
            <DropdownMenuSub key={c.id}>
              <DropdownMenuSubTrigger className="gap-3">
                {c.name}
                {c.hidden && <span className="text-xs text-muted-foreground">(hidden)</span>}
              </DropdownMenuSubTrigger>
              {/* Portalled: the parent menu scrolls and would clip an inline submenu. */}
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
                  <OptionChecks col={c} filter={filters.find((f) => f.id === c.id)} onToggle={(t) => onChange(toggleFilter(filters, c.id, t))} />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {filters.length > 0 && (
        <div role="group" aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {filters.map((f) => {
            const col = columns.find((c) => c.id === f.id);
            if (!col) return null;
            const text = `${col.name}: ${chipText(col, f)}`;
            return (
              <span key={f.id} className="inline-flex h-7 max-w-80 items-center rounded-full border border-border bg-muted text-xs font-medium text-foreground">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-filter-stop={f.id}
                      aria-label={`Edit ${col.name} filter: ${chipText(col, f)}`}
                      title={text}
                      className="h-full min-w-0 truncate rounded-l-full pr-1 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {text}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-auto min-w-40">
                    <OptionChecks col={col} filter={f} onToggle={(t) => toggleInChip(f.id, t)} />
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  aria-label={`Remove ${col.name} filter`}
                  onClick={() => remove(f.id)}
                  className="flex h-full items-center rounded-r-full pr-2 pl-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              focusAround(null);
              onChange([]);
            }}
          >
            Clear all
          </Button>
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-x-3">
        {total > 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            {filters.length > 0 ? `${shown} of ${total} applications` : `${total} application${total === 1 ? "" : "s"}`}
          </p>
        )}
        {trailing}
      </div>
    </div>
  );
}
