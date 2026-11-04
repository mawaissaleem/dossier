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
import { ColumnMenu, HiddenColumns } from "./column-menu";

// Props are plain data from the server page. No virtualisation yet: revisit if 500+ rows miss NFR-1.
export function ApplicationsTable({ trackId, columns, rows }: { trackId: number; columns: ColumnItem[]; rows: ApplicationRow[] }) {
  const defs = useMemo(() => buildColumns(columns), [columns]);
  const byId = useMemo(() => new Map(columns.map((c) => [columnId(c), c])), [columns]);
  const visible = columns.filter((c) => !c.hidden);
  const hidden = columns.filter((c) => c.hidden);
  const table = useTable({ features, columns: defs, data: rows, getRowId });

  return (
    <>
    <table className="border-collapse text-left">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => {
              const col = byId.get(header.column.id); // undefined for Title: no menu
              return (
                <th key={header.id} className="border px-2 py-1">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  {col?.isStatus && <span className="ml-1 rounded bg-foreground/10 px-1 text-xs font-normal">Status</span>}
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
                </th>
              );
            })}
            <th className="border px-2 py-1">
              <AddColumnDialog onSubmit={(name, type) => addColumn(trackId, name, type)} />
              <HiddenColumns columns={hidden} onShow={(id) => setColumnHidden(trackId, id, false)} />
            </th>
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getAllCells().map((cell) => {
              const col = byId.get(cell.column.id); // undefined for Title, which is a link to the detail page
              const kind = col && editorKind(col.type);
              return (
                <td key={cell.id} className="border px-2 py-1">
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
                  ) : cell.column.id === "title" ? (
                    <Link href={`/applications/${row.original.id}`} className="underline">{row.original.title}</Link>
                  ) : (
                    <table.FlexRender cell={cell} />
                  )}
                </td>
              );
            })}
            {/* under the "+" header cell, so the last column keeps its bottom border */}
            <td className="border px-2 py-1" />
          </tr>
        ))}
      </tbody>
    </table>
    {rows.length === 0 && <p>No applications yet.</p>}
    </>
  );
}
