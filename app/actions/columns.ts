"use server";

import { refresh } from "next/cache";
import { addColumn as insertColumn, deleteColumn as remove, getColumnDeleteImpact, type ColumnDeleteImpact, moveColumn as move, renameColumn as rename, setColumnHidden as setHidden, setStatusColumn as makeStatus, setColumnDefault as setDefault, type AddColumnResult, type ColumnResult } from "@/lib/db/columns";
import type { ColumnType } from "@/lib/db/schema";
import { isId } from "@/lib/ids";

// Runs on any POST, so the argument types are checked here; name, type and ownership rules live in the data layer.
// refresh() only on success: nothing changed otherwise, and the dialog keeps the typed name.
export async function addColumn(trackId: number, name: string, type: ColumnType): Promise<AddColumnResult> {
  if (!isId(trackId)) return { ok: false, error: "Track not found." };
  if (typeof name !== "string") return { ok: false, error: "Name is required." };
  if (typeof type !== "string") return { ok: false, error: "Choose a valid type." };
  const r = await insertColumn({ trackId, name, type });
  if (r.ok) refresh();
  return r;
}

const bad = { ok: false, error: "Column not found." } as const;

export async function renameColumn(trackId: number, columnId: number, name: string): Promise<ColumnResult> {
  if (!isId(trackId) || !isId(columnId)) return bad;
  if (typeof name !== "string") return { ok: false, error: "Name is required." };
  const r = await rename(trackId, columnId, name);
  if (r.ok) refresh();
  return r;
}

export async function setColumnHidden(trackId: number, columnId: number, hidden: boolean): Promise<ColumnResult> {
  if (!isId(trackId) || !isId(columnId) || typeof hidden !== "boolean") return bad;
  const r = await setHidden(trackId, columnId, hidden);
  if (r.ok) refresh();
  return r;
}

export async function moveColumn(trackId: number, columnId: number, direction: "left" | "right"): Promise<ColumnResult> {
  if (!isId(trackId) || !isId(columnId) || (direction !== "left" && direction !== "right")) return bad;
  const r = await move(trackId, columnId, direction);
  if (r.ok) refresh();
  return r;
}

// Read on each dialog open so the count is never stale page data.
export async function fetchColumnDeleteImpact(columnId: number): Promise<({ ok: true } & ColumnDeleteImpact) | { ok: false; error: string }> {
  if (!isId(columnId)) return bad;
  const impact = await getColumnDeleteImpact(columnId);
  return impact ? { ok: true, ...impact } : bad;
}

// `confirm` must be literally true: the UI sets it only after the user saw what will be lost (FR-2.3, NFR-4).
export async function deleteColumn(columnId: number, confirm: boolean): Promise<ColumnResult> {
  if (confirm !== true) return { ok: false, error: "Deleting must be confirmed." };
  if (!isId(columnId)) return bad;
  const r = await remove(columnId);
  if (r.ok) refresh();
  return r;
}

export async function setStatusColumn(trackId: number, columnId: number): Promise<ColumnResult> {
  if (!isId(trackId) || !isId(columnId)) return bad;
  const r = await makeStatus(trackId, columnId);
  if (r.ok) refresh();
  return r;
}

// value null or "" = no default. Only the shape is checked here; the type rules (parseCell) and ownership are in the data layer.
export async function setColumnDefault(columnId: number, value: string | number | boolean | null): Promise<ColumnResult> {
  if (!isId(columnId)) return bad;
  if (value !== null && !["string", "number", "boolean"].includes(typeof value)) return { ok: false, error: "Enter a valid default." };
  const r = await setDefault(columnId, value);
  if (r.ok) refresh();
  return r;
}
