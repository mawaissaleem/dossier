// Pure form logic: no DB or UI imports. Maps a column to its input and turns form state into the createApplication payload.
import { decodeDefault, type CellScalar } from "./cells";
import type { ColumnItem } from "./db/columns";
import type { ColumnType } from "./db/schema";
import { formatCell } from "./table";

export type InputKind = "text" | "number" | "date" | "checkbox" | "select";
// Link is a plain text input on purpose: type=url would reject "example.com", which the server accepts and turns into https://example.com/.
// Number is a text input too (inputMode decimal): type=number rejects values the server accepts and shows its own error text.
export const inputKind = (type: ColumnType): InputKind => {
  switch (type) {
    case "number": return "number";
    case "date": return "date";
    case "checkbox": return "checkbox";
    case "single_select": return "select";
    default: return "text"; // text, link
  }
};

// Keyed by column id, not position, so adding or removing a column never shifts what was typed.
// A column is in the state only once the user touched it: untouched = omitted (server applies the default),
// touched and cleared = blank (server stores nothing and skips the default).
export type FormState = Record<number, string | boolean>;
export type FormValue = { columnId: number; value: string | number | boolean | null };

// Entries for columns that still exist (a deleted column's leftover state is dropped). Strings are sent as typed;
// blank is null; a select value is the option id as a number. A select option deleted while the form is open is sent as
// blank (null), which is what the select then shows, so the payload never differs from the screen.
export function buildValues(cols: { id: number; type: ColumnType; options: { id: number }[] }[], state: FormState): FormValue[] {
  const out: FormValue[] = [];
  for (const c of cols) {
    const v = state[c.id];
    if (v === undefined) continue;
    if (typeof v === "boolean") out.push({ columnId: c.id, value: v });
    else if (v.trim() === "") out.push({ columnId: c.id, value: null });
    else if (c.type !== "single_select") out.push({ columnId: c.id, value: v });
    else out.push({ columnId: c.id, value: c.options.some((o) => o.id === Number(v)) ? Number(v) : null });
  }
  return out;
}

// Add form: what each input shows before the user touches it = the column's default, decoded with decodeDefault (the server's decoder).
// Only columns with a usable default are present; an invalid one, or a select default whose option is no longer among the column's
// options, is absent and shows blank (the server skips such a default too). The edit form has no defaults and does not use this.
type DefaultCol = Pick<ColumnItem, "id" | "type" | "options" | "defaultValue">;
export function defaultState(cols: DefaultCol[]): FormState {
  const out: FormState = {};
  for (const c of cols) {
    const v = decodeDefault(c.type, c.defaultValue);
    if (v === null) continue;
    if (c.type === "checkbox") out[c.id] = v === true;
    else if (c.type === "single_select") { if (c.options.some((o) => o.id === v)) out[c.id] = String(v); }
    else out[c.id] = formatCell(c, v);
  }
  return out;
}

// Add form payload: EVERY column, with the value the screen shows (touched value, else the default from the props the form rendered
// with, else blank), so the server never applies a default of its own. That is how "what is shown is what is saved" holds even if a
// default changed in another tab since the page loaded. A cleared field is sent as blank (null), so no default comes back.
// Limit: a select default whose option was deleted meanwhile is sent as is and the server refuses it ("Choose a valid option"), saving nothing.
export function buildCreateValues(cols: DefaultCol[], touched: FormState): FormValue[] {
  return buildValues(cols, { ...Object.fromEntries(cols.map((c) => [c.id, ""])), ...defaultState(cols), ...touched });
}

// Edit form start state: EVERY column, from the loaded values (no defaults, those are for new applications). Blank shows as "" and an
// unchecked or blank checkbox as false; a select is its option id as text.
export function initialState(cols: Pick<ColumnItem, "id" | "type" | "options">[], values: Record<number, CellScalar | null>): FormState {
  const out: FormState = {};
  for (const c of cols) {
    const v = values[c.id] ?? null;
    out[c.id] = c.type === "checkbox" ? v === true : c.type === "single_select" ? (v === null ? "" : String(v)) : formatCell(c, v);
  }
  return out;
}

// The part of `state` that differs from `initial` (what the form loaded), so saving only writes what the user changed and never
// overwrites a cell edited elsewhere since the page loaded. Per column, compared after trimming strings; missing and false both
// count as "" (a blank cell and an unchecked box look the same). So retyping the same text, or checking then unchecking a box, is
// no change; "52000.50" over a loaded "52000.5" is one (compared as text, not as a number) and rewrites the same number.
const norm = (v: string | boolean | undefined) => (v === true ? "true" : typeof v === "string" ? v.trim() : "");
export function changedState(cols: { id: number }[], state: FormState, initial: FormState): FormState {
  const out: FormState = {};
  for (const c of cols) if (c.id in state && norm(state[c.id]) !== norm(initial[c.id])) out[c.id] = state[c.id];
  return out;
}

// Essentials = Status (the isStatus column), then Priority (single_select) and Deadline (date) matched by name, trimmed and
// case-insensitive: the schema has no flag for them. Fixed order: status, priority, deadline. A hidden column is never essential.
// Limits: renaming "Deadline" or changing its type moves it to `rest`; with two matches the first (column order) wins, the other goes to `rest`.
// A track missing any of them just has fewer essentials. `rest` keeps column order.
type SplitCol = { name: string; type: ColumnType; hidden: boolean; isStatus: boolean };
export function splitEssentials<T extends SplitCol>(cols: T[]): { essentials: T[]; rest: T[] } {
  const named = (name: string, type: ColumnType) => cols.find((c) => !c.hidden && c.type === type && c.name.trim().toLowerCase() === name);
  const essentials = [cols.find((c) => !c.hidden && c.isStatus), named("priority", "single_select"), named("deadline", "date")].filter((c): c is T => c !== undefined);
  return { essentials, rest: cols.filter((c) => !essentials.includes(c)) };
}

// The server prefixes field errors with "<column name>: ". True when the error names one of these columns.
export const errorNamesColumn = (error: string | null | undefined, cols: { name: string }[]) =>
  !!error && cols.some((c) => error.startsWith(`${c.name}: `));
