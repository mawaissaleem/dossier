"use server";

import { refresh } from "next/cache";
import { addOption as insert, deleteOption as remove, getOptionDeleteImpact, reorderOptions as reorder, updateOption as update, type AddOptionResult, type OptionDeleteImpact, type OptionResult } from "@/lib/db/options";
import { isId } from "@/lib/ids";

// Runs on any POST, so the argument types are checked here; label, colour and ownership rules live in the data layer.
// refresh() only on success: nothing changed otherwise, and the editor keeps what was typed.
export async function addOption(columnId: number, label: string): Promise<AddOptionResult> {
  if (!isId(columnId)) return { ok: false, error: "Column not found." };
  if (typeof label !== "string") return { ok: false, error: "Label is required." };
  const r = await insert(columnId, label);
  if (r.ok) refresh();
  return r;
}

export async function updateOption(columnId: number, optionId: number, patch: { label?: string; color?: string }): Promise<OptionResult> {
  if (!isId(columnId)) return { ok: false, error: "Column not found." };
  if (!isId(optionId)) return { ok: false, error: "Option not found." };
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { ok: false, error: "Nothing to change." };
  if ((patch.label !== undefined && typeof patch.label !== "string") || (patch.color !== undefined && typeof patch.color !== "string")) {
    return { ok: false, error: "Nothing to change." };
  }
  const r = await update(columnId, optionId, { label: patch.label, color: patch.color }); // only the two known keys reach the data layer
  if (r.ok) refresh();
  return r;
}

// The full new order in one call; the data layer checks it is exactly the column's option ids.
// refresh() on failure too: a stale list (options changed elsewhere) must come back as the real server order.
export async function reorderOptions(columnId: number, orderedIds: number[]): Promise<OptionResult> {
  if (!isId(columnId)) return { ok: false, error: "Column not found." };
  if (!Array.isArray(orderedIds) || !orderedIds.every(isId)) return { ok: false, error: "Invalid option order." };
  const r = await reorder(columnId, orderedIds);
  refresh();
  return r;
}

// Read on each dialog open so the count is never stale page data.
export async function fetchOptionDeleteImpact(optionId: number): Promise<({ ok: true } & OptionDeleteImpact) | { ok: false; error: string }> {
  if (!isId(optionId)) return { ok: false, error: "Option not found." };
  const impact = await getOptionDeleteImpact(optionId);
  return impact ? { ok: true, ...impact } : { ok: false, error: "Option not found." };
}

// `confirm` must be literally true and `reassignTo` explicit: another option's id, or null to leave those applications blank (FR-3.4, NFR-4).
export async function deleteOption(optionId: number, choice: { confirm: boolean; reassignTo: number | null }): Promise<OptionResult> {
  if (typeof choice !== "object" || choice === null || choice.confirm !== true) return { ok: false, error: "Deleting must be confirmed." };
  if (!isId(optionId)) return { ok: false, error: "Option not found." };
  if (choice.reassignTo !== null && !isId(choice.reassignTo)) return { ok: false, error: "Choose another option of this column to reassign to." };
  const r = await remove(optionId, choice.reassignTo);
  if (r.ok) refresh();
  return r;
}
