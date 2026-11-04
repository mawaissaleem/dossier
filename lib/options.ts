// Pure: shared option helpers, no DB or UI imports.
export const MAX_OPTION_LABEL = 100;

// The one id -> option lookup used by the table formatter, the dropdown cell and the detail page, so a rename/recolour shows the same everywhere (FR-3.3).
export const findOption = <T extends { id: number }>(options: T[], id: unknown): T | undefined => options.find((o) => o.id === id);

// Trimmed label, or the error. Shared by add and update so the rules cannot drift.
export function checkOptionLabel(label: unknown): { label: string } | { error: string } {
  const l = typeof label === "string" ? label.trim() : "";
  if (!l) return { error: "Label is required." };
  if (l.length > MAX_OPTION_LABEL) return { error: `Label must be at most ${MAX_OPTION_LABEL} characters.` };
  return { label: l };
}

// Case-insensitive duplicate check (the DB index is case-sensitive). `exceptId` skips the option being edited.
export const labelTaken = (options: { id: number; label: string }[], label: string, exceptId?: number): boolean =>
  options.some((o) => o.id !== exceptId && o.label.toLowerCase() === label.toLowerCase());

// True when `ordered` holds exactly the ids in `current`, each once (no missing, extra, duplicate or foreign ids).
export const isSameIdSet = (current: number[], ordered: unknown): ordered is number[] =>
  Array.isArray(ordered) && ordered.length === current.length && new Set(ordered).size === ordered.length && ordered.every((id) => current.includes(id));
