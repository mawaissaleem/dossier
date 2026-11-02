"use server";

import { refresh } from "next/cache";
import { setCellValue, type SetCellResult } from "@/lib/db/cells";

const isId = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1;

// Generic for every column type: setCellValue validates `raw` against the column's type, and blank deletes the value.
// Runs on any POST, so the ids are checked here; raw is `unknown` and parseCell rejects wrong shapes.
// refresh() only on success: nothing changed otherwise, and the client keeps its typed text.
export async function updateCell(applicationId: number, columnId: number, raw: unknown): Promise<SetCellResult> {
  if (!isId(applicationId)) return { ok: false, error: "Application not found." };
  if (!isId(columnId)) return { ok: false, error: "Column not found." };
  const r = await setCellValue(applicationId, columnId, raw);
  if (r.ok) refresh();
  return r;
}
