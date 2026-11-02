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

// Props are plain data from the server page. No virtualisation yet: revisit if 500+ rows miss NFR-1.
export function ApplicationsTable({ columns, rows }: { columns: ColumnItem[]; rows: ApplicationRow[] }) {
  const defs = useMemo(() => buildColumns(columns), [columns]);
  const byId = useMemo(() => new Map(columns.map((c) => [columnId(c), c])), [columns]);
  const table = useTable({ features, columns: defs, data: rows, getRowId });

  if (rows.length === 0) return <p>No applications yet.</p>;
  return (
    <table className="border-collapse text-left">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} className="border px-2 py-1">
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </th>
            ))}
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
