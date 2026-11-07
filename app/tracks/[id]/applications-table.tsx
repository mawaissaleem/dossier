"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { buildColumns, columnId, editorKind, features, formatCell, getRowId } from "@/lib/table";
import { safeHref } from "@/lib/cells";
import { CheckboxCell } from "./checkbox-cell";
import { EditableCell } from "./editable-cell";
import { SelectCell } from "./select-cell";
import { addColumn, deleteColumn, fetchColumnDeleteImpact, moveColumn, renameColumn, setColumnHidden, setStatusColumn, setColumnDefault } from "@/app/actions/columns";
import { addOption, deleteOption, fetchOptionDeleteImpact, reorderOptions, updateOption } from "@/app/actions/options";
import { AddColumnDialog } from "./add-column-dialog";
import { CalendarIcon, ChevronsUpDownIcon, HashIcon, LinkIcon, SquareCheckIcon, TypeIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { ColumnType } from "@/lib/db/schema";
import { ColumnMenu, HiddenColumns } from "./column-menu";

const TYPE_ICONS: Record<ColumnType, typeof TypeIcon> = { text: TypeIcon, number: HashIcon, date: CalendarIcon, link: LinkIcon, checkbox: SquareCheckIcon, single_select: ChevronsUpDownIcon };
// 40px rows (h-10: a 32px control plus 4px padding, so entering edit mode never moves a row), 36px header. Grid lines are border-b/border-r on each cell (border-separate keeps them on sticky cells).
const cell = "h-10 border-b border-r border-border px-2 py-1 align-middle";
const headCell = "sticky top-0 z-20 h-9 border-b border-r border-border bg-card px-2 text-left text-xs font-medium text-muted-foreground";

// Props are plain data from the server page. No virtualisation yet: revisit if 500+ rows miss NFR-1.
export function ApplicationsTable({ trackId, columns, rows }: { trackId: number; columns: ColumnItem[]; rows: ApplicationRow[] }) {
  const defs = useMemo(() => buildColumns(columns), [columns]);
  const byId = useMemo(() => new Map(columns.map((c) => [columnId(c), c])), [columns]);
  const visible = columns.filter((c) => !c.hidden);
  const hidden = columns.filter((c) => c.hidden);
  const table = useTable({ features, columns: defs, data: rows, getRowId });

  return (
    <>
    {hidden.length > 0 && (
      <div className="mb-2 flex flex-wrap justify-end gap-x-2">
        <HiddenColumns columns={hidden} onShow={(id) => setColumnHidden(trackId, id, false)} />
      </div>
    )}
    {/* The table scrolls inside its own area (both ways, so the sticky header and Title column work); the page never scrolls sideways. */}
    <div className="max-h-[75vh] overflow-auto rounded-lg border border-border">
    <table className="w-full min-w-max border-separate border-spacing-0 text-left text-sm tabular-nums [&_tr>:last-child]:border-r-0 [&_tbody>tr:last-child>td]:border-b-0">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const col = byId.get(header.column.id); // undefined for Title: no menu
              const Icon = col && TYPE_ICONS[col.type];
              return (
                <th key={header.id} className={cn(headCell, !col && "left-0 z-30 min-w-48")}>
                  <div className="flex flex-wrap items-center gap-x-1.5 whitespace-nowrap">
                    {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                    <span className={cn("flex-1 whitespace-nowrap", col?.type === "number" && "text-right")}>
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </span>
                    {col?.isStatus && <span className="rounded-sm bg-muted px-1.5 text-xs font-medium text-foreground">Status</span>}
                    {col && (
                      <ColumnMenu
                        column={col}
                        first={visible[0]?.id === col.id}
                        last={visible.at(-1)?.id === col.id}
                        onRename={(name) => renameColumn(trackId, col.id, name)}
                        onHide={() => setColumnHidden(trackId, col.id, true)}
                        onMove={(dir) => moveColumn(trackId, col.id, dir)}
                        onLoadImpact={() => fetchColumnDeleteImpact(col.id)}
                        onDelete={() => deleteColumn(col.id, true)}
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
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} className="group hover:bg-muted">
            {row.getAllCells().map((cell_) => {
              const col = byId.get(cell_.column.id); // undefined for Title, which is a link to the detail page
              const kind = col && editorKind(col.type);
              return (
                <td key={cell_.id} className={cn(cell, !col && "sticky left-0 z-10 min-w-48 bg-background group-hover:bg-muted")}>
                  {col?.type === "checkbox" ? (
                    <CheckboxCell
                      applicationId={row.original.id}
                      columnId={col.id}
                      checked={row.original.values[col.id] === true}
                      label={`${col.name}, ${row.original.title}`}
                    />
                  ) : col?.type === "single_select" ? (
                    <SelectCell
                      applicationId={row.original.id}
                      columnId={col.id}
                      value={row.original.values[col.id]}
                      options={col.options}
                      label={`${col.name}, ${row.original.title}`}
                    />
                  ) : col && kind ? (
                    <EditableCell
                      applicationId={row.original.id}
                      columnId={col.id}
                      text={formatCell(col, row.original.values[col.id])}
                      label={`${col.name}, ${row.original.title}`}
                      kind={kind}
                      href={kind === "link" ? safeHref(formatCell(col, row.original.values[col.id])) : null}
                    />
                  ) : cell_.column.id === "title" ? (
                    <Link href={`/applications/${row.original.id}`} title={row.original.title} className="block max-w-80 truncate rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{row.original.title}</Link>
                  ) : (
                    <table.FlexRender cell={cell_} />
                  )}
                </td>
              );
            })}
            {/* under the "+" header cell, so the grid stays unbroken */}
            <td className={cell} />
          </tr>
        ))}
      </tbody>
    </table>
    </div>
    {rows.length === 0 && <EmptyState title="No applications yet" description="Add one with a title in the form above." className="mt-4" />}
    </>
  );
}
