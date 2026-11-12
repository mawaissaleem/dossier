// Pure planner rules (FR-8), no DB, React or clock imports. 10.1: the four engine slots.
import { dayNumber } from "./deadline";
import { isDeadline, isPriority } from "./priority";
import type { ColumnType } from "./db/schema";

export const SLOTS = ["priority", "deadline", "effort", "followUp"] as const;
export type Slot = (typeof SLOTS)[number];
export type SlotMapping = Record<Slot, number | null>;
export type SlotColumn = { id: number; name: string; type: ColumnType; hidden: boolean };

const name = (c: SlotColumn) => c.name.trim().toLowerCase();

// Label, required column type and the name that picks the default column (FR-8.1; defaults per phase-10-decisions).
export const SLOT_DEFS: Record<Slot, { label: string; type: ColumnType; isDefault: (c: SlotColumn) => boolean }> = {
  priority: { label: "Priority", type: "single_select", isDefault: isPriority },
  deadline: { label: "Deadline", type: "date", isDefault: isDeadline },
  effort: { label: "Effort", type: "single_select", isDefault: (c) => c.type === "single_select" && name(c) === "effort" },
  followUp: { label: "Follow-up date", type: "date", isDefault: (c) => c.type === "date" && name(c) === "follow-up date" },
};

const mapSlots = (f: (slot: Slot) => number | null): SlotMapping => ({ priority: f("priority"), deadline: f("deadline"), effort: f("effort"), followUp: f("followUp") });

// Columns that may feed a slot: the right type, in the order given.
export const slotChoices = (slot: Slot, columns: SlotColumn[]) => columns.filter((c) => c.type === SLOT_DEFS[slot].type);

// `stored` is the parsed setting. Never saved (or not an object) = the first visible column per slot that matches by name and type.
// A saved mapping keeps only ids that are still columns of the right type in this track's `columns`; the rest resolve to empty, silently.
export function resolveSlots(stored: unknown, columns: SlotColumn[]): SlotMapping {
  const m = resolveSaved(stored, columns);
  return m.effort !== null && m.effort === m.priority ? { ...m, effort: null } : m; // one column must not count its buffer twice
}

function resolveSaved(stored: unknown, columns: SlotColumn[]): SlotMapping {
  const saved = stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : null;
  return mapSlots((slot) => {
    const choices = slotChoices(slot, columns);
    if (!saved) return choices.find((c) => !c.hidden && SLOT_DEFS[slot].isDefault(c))?.id ?? null;
    return choices.find((c) => c.id === saved[slot])?.id ?? null;
  });
}

// The mapping to save, or an error. Every slot must be present as null or the id of a column of the right type in `columns`.
export function checkSlots(input: unknown, columns: SlotColumn[]): { slots: SlotMapping } | { error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { error: "Choose a column for each slot." };
  const given = input as Record<string, unknown>;
  const slots = {} as SlotMapping;
  for (const slot of SLOTS) {
    const v = given[slot];
    if (v === null) { slots[slot] = null; continue; }
    if (!Number.isInteger(v)) return { error: `Choose a column for ${SLOT_DEFS[slot].label} from the list.` };
    const col = columns.find((c) => c.id === v);
    if (!col) return { error: `${SLOT_DEFS[slot].label}: that column is not in this track.` };
    if (col.type !== SLOT_DEFS[slot].type) return { error: `${SLOT_DEFS[slot].label} needs a ${SLOT_DEFS[slot].type === "date" ? "date" : "single-select"} column.` };
    slots[slot] = col.id;
  }
  if (slots.priority !== null && slots.priority === slots.effort) return { error: "Priority and Effort need different columns, otherwise the same buffer would count twice." };
  return { slots };
}

// Buffers a reset gives the options of the Priority and Effort slot columns (the seed's values, lower-cased labels); every other label gets NULL (= 0).
const SEED_BUFFERS = { priority: { priority: 3, "good-to-have": 0 }, effort: { heavy: 2, medium: 1, light: 0 } } as const satisfies Record<"priority" | "effort", Record<string, number>>;
export function defaultBuffer(slot: "priority" | "effort", label: string): number | null {
  const m: Record<string, number> = SEED_BUFFERS[slot];
  const key = label.trim().toLowerCase();
  return Object.hasOwn(m, key) ? m[key] : null; // own keys only: "constructor" / "__proto__" are labels, not inherited members
}

export const MAX_BUFFER_DAYS = 365;

// A buffer to save: a whole number of days 0..365, or null (blank, counts as 0).
export function checkBuffer(input: unknown): { days: number | null } | { error: string } {
  if (input === null) return { days: null };
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input > MAX_BUFFER_DAYS) return { error: `Enter a whole number of days from 0 to ${MAX_BUFFER_DAYS}, or leave it blank.` };
  return { days: input };
}

// Raw buffer text to the action's input: digits -> number, blank -> null, anything else stays a string so checkBuffer refuses it.
export function parseBufferInput(raw: string): number | null | string {
  const t = raw.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : raw;
}

// ---- 10.3: scoring (FR-8.3, FR-8.7). Plain data in, no DB rows, no clock: `today` is a YYYY-MM-DD parameter. ----

export type BufferOption = { id: number; position: number; bufferDays: number | null }; // NULL buffer counts as 0
export type PlannerApp = { id: number; deadline: unknown; priority: number | null; effort: number | null };
export type Scored = {
  app: PlannerApp;
  score: number;
  daysLeft: number; // negative = overdue
  priority: { optionId: number | null; buffer: number; fallback: boolean }; // fallback: no usable value, so the lowest priority option's buffer was used
  effort: { optionId: number | null; buffer: number };
};

// Calendar days from `today` to `deadline`, or null when either is not a real YYYY-MM-DD day.
export function daysLeft(deadline: unknown, today: string): number | null {
  const d = dayNumber(deadline);
  const t = dayNumber(today);
  return d === null || t === null ? null : d - t;
}

const buf = (o: BufferOption) => o.bufferDays ?? 0;

// FR-8.7: the lowest priority option = the smallest buffer; ties go to the last by position. No options = null.
export function lowestPriorityOption(options: BufferOption[]): BufferOption | null {
  return options.reduce<BufferOption | null>((low, o) => (!low || buf(o) < buf(low) || (buf(o) === buf(low) && o.position >= low.position) ? o : low), null);
}

// The buffers an application gets: its Priority option (else the FR-8.7 lowest) and its Effort option (else none).
function buffersOf(app: PlannerApp, priorityOptions: BufferOption[], effortOptions: BufferOption[]): Pick<Scored, "priority" | "effort"> {
  const chosen = priorityOptions.find((o) => o.id === app.priority);
  const p = chosen ?? lowestPriorityOption(priorityOptions);
  const e = effortOptions.find((o) => o.id === app.effort);
  return { priority: { optionId: p?.id ?? null, buffer: p ? buf(p) : 0, fallback: !chosen }, effort: { optionId: e?.id ?? null, buffer: e ? buf(e) : 0 } };
}

// Score = days left - priority buffer - effort buffer. null when the deadline is blank or not a real date (the undated policy is 10.5, below).
export function scoreApplication(app: PlannerApp, today: string, priorityOptions: BufferOption[], effortOptions: BufferOption[]): Scored | null {
  const left = daysLeft(app.deadline, today);
  if (left === null) return null;
  const b = buffersOf(app, priorityOptions, effortOptions);
  return { app, score: left - b.priority.buffer - b.effort.buffer, daysLeft: left, ...b };
}

// Lowest score first; ties: earlier deadline (fewer days left), then lower id. Applications without a valid deadline come back in `undated`, in input order.
export function rankApplications(apps: PlannerApp[], today: string, priorityOptions: BufferOption[], effortOptions: BufferOption[]): { ranked: Scored[]; undated: PlannerApp[] } {
  if (dayNumber(today) === null) throw new Error(`today must be a YYYY-MM-DD day, got ${String(today)}`);
  const ranked: Scored[] = [];
  const undated: PlannerApp[] = [];
  for (const app of apps) {
    const s = scoreApplication(app, today, priorityOptions, effortOptions);
    if (s) ranked.push(s); else undated.push(app);
  }
  ranked.sort(compareScored);
  return { ranked, undated };
}

// Lowest score first; ties: earlier deadline (fewer days left), then lower id. Shared so lists scored per track can be merged (10.4).
export const compareScored = (a: Scored, b: Scored) => a.score - b.score || a.daysLeft - b.daysLeft || a.app.id - b.app.id;

// ---- 10.4: still-to-do statuses (FR-8.4) ----

type StatusOpt = { id: number };

// Never saved: the status options before the first submitted one (option order); none submitted = every option.
export function defaultStillToDo(options: StatusOpt[], submittedIds: number[]): number[] {
  const first = options.findIndex((o) => submittedIds.includes(o.id));
  return (first === -1 ? options : options.slice(0, first)).map((o) => o.id);
}

// `stored` is the parsed setting. Not a list (never saved, unreadable) = the default; a saved list keeps only ids that are still
// status options, in option order, silently dropping the rest. An empty saved list stays empty (nothing is ranked).
export function resolveStillToDo(stored: unknown, options: StatusOpt[], submittedIds: number[]): number[] {
  return Array.isArray(stored) ? options.filter((o) => stored.includes(o.id)).map((o) => o.id) : defaultStillToDo(options, submittedIds);
}

// ---- 10.5: overdue and no-deadline rules (FR-8.5, FR-8.6) ----

export const OVERDUE_POLICIES = ["pin", "hide", "normal"] as const;
export type OverduePolicy = (typeof OVERDUE_POLICIES)[number];
export const NO_DEADLINE_POLICIES = ["stale", "last", "ignore"] as const;
export type NoDeadlinePolicy = (typeof NO_DEADLINE_POLICIES)[number];

export const isOverduePolicy = (v: unknown): v is OverduePolicy => OVERDUE_POLICIES.includes(v as OverduePolicy);
export const isNoDeadlinePolicy = (v: unknown): v is NoDeadlinePolicy => NO_DEADLINE_POLICIES.includes(v as NoDeadlinePolicy);

// Stored value to the policy in force: anything unknown (never saved, unreadable, a retired value) = the default.
export const resolveOverdue = (stored: unknown): OverduePolicy => (isOverduePolicy(stored) ? stored : "pin");
export const resolveNoDeadline = (stored: unknown): NoDeadlinePolicy => (isNoDeadlinePolicy(stored) ? stored : "last");

// An application without a usable deadline: the buffers it would get (priority + effort, for `last`) and whole days since it was last touched
// (`lastTouched` is a YYYY-MM-DD day; a bad value or a day after today counts as 0). `id` is the application's, for the final tie-break.
export type UndatedScore = Pick<Scored, "priority" | "effort"> & { id: number; buffer: number; daysUntouched: number };
export function undatedScore(app: PlannerApp, lastTouched: unknown, today: string, priorityOptions: BufferOption[], effortOptions: BufferOption[]): UndatedScore {
  const b = buffersOf(app, priorityOptions, effortOptions);
  return { id: app.id, ...b, buffer: b.priority.buffer + b.effort.buffer, daysUntouched: Math.max(0, -(daysLeft(lastTouched, today) ?? 0)) };
}

// The final order. Dated first: `pin` puts overdue ones (days left < 0) ahead of the rest, each flagged `overdue`, then the rest by score;
// `hide` drops overdue ones; `normal` leaves them where their (negative) score puts them, unflagged. Then, after every dated one, the
// undated: `last` = biggest priority+effort buffer first, `stale` = longest untouched first, `ignore` = left out; ties by id.
// Only the order and membership change; the items keep every field they came with.
export function orderRanking<S extends Scored, U extends { id: number; buffer: number; daysUntouched: number }>(
  ranked: S[], undated: U[], overdue: OverduePolicy, noDeadline: NoDeadlinePolicy,
): { ranked: (S & { overdue: boolean })[]; undated: U[] } {
  const sorted = [...ranked].sort(compareScored);
  const late = sorted.filter((s) => s.daysLeft < 0);
  const rest = sorted.filter((s) => s.daysLeft >= 0);
  const flagged = (list: S[], overdue: boolean) => list.map((s) => ({ ...s, overdue }));
  const dated = overdue === "pin" ? [...flagged(late, true), ...flagged(rest, false)] : overdue === "hide" ? flagged(rest, false) : flagged(sorted, false);
  const byId = (a: U, b: U) => a.id - b.id;
  const rows = noDeadline === "ignore" ? [] : [...undated].sort(noDeadline === "last" ? (a, b) => b.buffer - a.buffer || byId(a, b) : (a, b) => b.daysUntouched - a.daysUntouched || byId(a, b));
  return { ranked: dated, undated: rows };
}

// ---- 10.6: reasoning text (FR-8.9) ----

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

// "Priority (+3), Heavy effort (+2), due in 5 days". A null priority label = no usable Priority value (FR-8.7 fallback), shown as "No priority".
// A null effort label = no Effort value, so that part is left out. Time part: `daysLeft` set = dated (negative = overdue); otherwise `daysUntouched`
// set = the "stale" rule ("untouched for N days"); both null = the "last" rule.
export function reasoning(item: {
  priority: { label: string | null; buffer: number }; effort: { label: string | null; buffer: number };
  daysLeft: number | null; daysUntouched: number | null;
}): string {
  const { priority: p, effort: e, daysLeft: left, daysUntouched: idle } = item;
  const time = left !== null
    ? left < 0 ? `overdue by ${days(-left)}` : left === 0 ? "due today" : left === 1 ? "due tomorrow" : `due in ${days(left)}`
    : idle === null ? "no deadline" : idle === 0 ? "no deadline, untouched today" : `no deadline, untouched for ${days(idle)}`;
  return [`${p.label ?? "No priority"} (+${p.buffer})`, ...(e.label === null ? [] : [`${e.label} effort (+${e.buffer})`]), time].join(", ");
}

// ---- 10.8: weekly capacity (FR-8.8) ----

export const DEFAULT_CAPACITY = 4;
export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 50;

const validCapacity = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= MIN_CAPACITY && v <= MAX_CAPACITY;

// Stored value to the capacity in force: anything that is not a whole number 1..50 (never saved, unreadable, hand-edited) = the default.
export const resolveCapacity = (stored: unknown): number => (validCapacity(stored) ? stored : DEFAULT_CAPACITY);

// A capacity to save: a whole number 1..50.
export function checkCapacity(input: unknown): { capacity: number } | { error: string } {
  if (!validCapacity(input)) return { error: `Enter a whole number from ${MIN_CAPACITY} to ${MAX_CAPACITY}.` };
  return { capacity: input };
}

// Raw field text to the action's input: digits -> number, anything else (blank included) stays a string so checkCapacity refuses it.
export const parseCapacityInput = (raw: string): number | string => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw);

// This week's plan (FR-8.8): the first `capacity` of the final ordering (dated ones, then the undated as the no-deadline rule placed them), and the rest.
export function weeksPlan<T>(ranking: T[], capacity: number): { plan: T[]; rest: T[] } {
  const n = resolveCapacity(capacity);
  return { plan: ranking.slice(0, n), rest: ranking.slice(n) };
}

// ---- 10.9: follow-ups due (FR-8.10). Not part of the ranking. ----

export type FollowUpInput = { id: number; followUp: unknown; hasSubmission: boolean; submittedStatus: boolean };

// Submitted applications (a submission row, or a submitted current status) whose follow-up date is today or earlier. A blank or invalid date
// never counts. Oldest follow-up first, then id. `daysAgo` is 0 for today; `text` is "due today" / "1 day ago" / "N days ago".
export function followUpsDue<T extends FollowUpInput>(items: T[], today: string): (T & { daysAgo: number; text: string })[] {
  const out: (T & { daysAgo: number; text: string })[] = [];
  for (const it of items) {
    const left = daysLeft(it.followUp, today);
    if (left === null || left > 0 || !(it.hasSubmission || it.submittedStatus)) continue;
    out.push({ ...it, daysAgo: left === 0 ? 0 : -left, text: left === 0 ? "due today" : `${days(-left)} ago` });
  }
  return out.sort((a, b) => b.daysAgo - a.daysAgo || a.id - b.id);
}
