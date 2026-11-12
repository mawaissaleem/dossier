// Server-only. Planner settings (FR-8) stored in the settings table; 10.1: the engine slot mapping per track.
import { cache } from "react";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { checkSubmittedIds } from "../submitted-statuses";
import {
  checkBuffer, checkCapacity, defaultBuffer, checkSlots, resolveCapacity, weeksPlan, orderRanking, rankApplications, isNoDeadlinePolicy, isOverduePolicy, resolveNoDeadline, resolveOverdue, resolveSlots, resolveStillToDo,
  reasoning, slotChoices, SLOTS, undatedScore, followUpsDue, type FollowUpInput,
  type BufferOption as ScoreOption, type NoDeadlinePolicy, type OverduePolicy, type PlannerApp, type Scored, type Slot, type SlotColumn, type SlotMapping, type UndatedScore,
} from "../planner";
import { overdueAlerts, streak, upcomingDeadlines, weeklyProgress, type OverdueAlert, type UpcomingDeadline, type WeeklyProgress } from "../dashboard";
import { localToday } from "../deadline";
import { getDb } from "./client";
import { activityEvents, applications, cellValues, columnOptions, columns, notes, settings, submissions, tracks } from "./schema";
import { readSetting, setSetting } from "./settings";
import { statusOptions, submittedStatusIds } from "./track-settings";
import { getUserId } from "./user";

export const plannerSlotsKey = (trackId: number) => `track.${trackId}.planner_slots`;

// The track's columns in order. Empty when the track is not the user's.
function trackColumns(trackId: number): SlotColumn[] {
  const userId = getUserId();
  return getDb()
    .select({ id: columns.id, name: columns.name, type: columns.type, hidden: columns.hidden })
    .from(columns)
    .innerJoin(tracks, eq(tracks.id, columns.trackId))
    .where(and(eq(tracks.id, trackId), eq(tracks.userId, userId), eq(columns.userId, userId)))
    .orderBy(asc(columns.position), asc(columns.id))
    .all();
}

// The slot mapping in force for a track (saved, else the defaults), with each slot's column choices (the settings page).
export async function getPlannerSlots(trackId: number): Promise<{ slots: SlotMapping; choices: Record<Slot, SlotColumn[]> }> {
  const cols = trackColumns(trackId);
  return {
    slots: resolveSlots(readSetting(plannerSlotsKey(trackId)), cols),
    choices: Object.fromEntries(SLOTS.map((s) => [s, slotChoices(s, cols)])) as Record<Slot, SlotColumn[]>,
  };
}

// Saves the mapping for one track. Refuses a column of another track or the wrong type; nothing is saved on error.
export async function setPlannerSlots(trackId: number, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!getDb().select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.userId, getUserId()))).get()) return { ok: false, error: "Track not found." };
  const cols = trackColumns(trackId);
  const checked = checkSlots(input, cols);
  if ("error" in checked) return { ok: false, error: checked.error };
  await setSetting(plannerSlotsKey(trackId), checked.slots);
  return { ok: true };
}

export type BufferOption = { id: number; label: string; color: string; bufferDays: number | null };
export type BufferSlot = "priority" | "effort";
export type PlannerBuffers = Record<BufferSlot, { column: string; options: BufferOption[] } | null>;

// The options (in order) of the track's current Priority and Effort columns, with their buffers; null for an empty slot.
export async function getPlannerBuffers(trackId: number): Promise<PlannerBuffers> {
  const { slots, choices } = await getPlannerSlots(trackId);
  const one = (slot: BufferSlot) => {
    const id = slots[slot];
    if (id === null) return null;
    const options = getDb()
      .select({ id: columnOptions.id, label: columnOptions.label, color: columnOptions.color, bufferDays: columnOptions.bufferDays })
      .from(columnOptions)
      .where(and(eq(columnOptions.columnId, id), eq(columnOptions.userId, getUserId())))
      .orderBy(asc(columnOptions.position), asc(columnOptions.id))
      .all();
    return { column: choices[slot].find((c) => c.id === id)!.name, options };
  };
  return { priority: one("priority"), effort: one("effort") };
}

// Sets one option's buffer (whole days 0..365, null = blank). Only options of the column now in the track's Priority or Effort slot.
export async function setOptionBuffer(optionId: unknown, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const checked = checkBuffer(input);
  if ("error" in checked) return { ok: false, error: checked.error };
  const userId = getUserId();
  const opt = Number.isInteger(optionId)
    ? getDb()
        .select({ columnId: columnOptions.columnId, trackId: columns.trackId })
        .from(columnOptions)
        .innerJoin(columns, eq(columns.id, columnOptions.columnId))
        .where(and(eq(columnOptions.id, optionId as number), eq(columnOptions.userId, userId), eq(columns.userId, userId)))
        .get()
    : undefined;
  if (!opt) return { ok: false, error: "Option not found." };
  const slots = resolveSlots(readSetting(plannerSlotsKey(opt.trackId)), trackColumns(opt.trackId));
  if (opt.columnId !== slots.priority && opt.columnId !== slots.effort) return { ok: false, error: "Buffers can only be set for options of the Priority or Effort column." };
  getDb().update(columnOptions).set({ bufferDays: checked.days, updatedAt: new Date() }).where(and(eq(columnOptions.id, optionId as number), eq(columnOptions.userId, userId))).run();
  return { ok: true };
}

export const stillToDoKey = (trackId: number) => `track.${trackId}.still_to_do`;

// Status option ids that are "still to do" for a track (FR-8.4): saved list (deleted ids dropped), else the options before the first submitted status.
function stillToDoIds(trackId: number): number[] {
  return resolveStillToDo(readSetting(stillToDoKey(trackId)), statusOptions(trackId), submittedStatusIds(trackId));
}

// The track's status options with their checked state (the settings page).
export async function getStillToDoChoices(trackId: number) {
  const on = new Set(stillToDoIds(trackId));
  return statusOptions(trackId).map((o) => ({ ...o, stillToDo: on.has(o.id) }));
}

// Replaces the set. Refuses ids that are not options of this track's status column; an empty list is allowed (nothing is ranked).
export async function setStillToDo(trackId: number, ids: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const options = statusOptions(trackId);
  if (!options.length) return { ok: false, error: "This track has no status options." };
  const checked = checkSubmittedIds(ids, options);
  if ("error" in checked) return { ok: false, error: checked.error };
  await setSetting(stillToDoKey(trackId), checked.ids);
  return { ok: true };
}

export const OVERDUE_KEY = "planner.overdue";
export const NO_DEADLINE_KEY = "planner.no_deadline";

// The two global ranking rules in force (FR-8.5, FR-8.6): saved, else pin / last.
export async function getRankingRules(): Promise<{ overdue: OverduePolicy; noDeadline: NoDeadlinePolicy }> {
  return { overdue: resolveOverdue(readSetting(OVERDUE_KEY)), noDeadline: resolveNoDeadline(readSetting(NO_DEADLINE_KEY)) };
}

// Saves both rules together; an unknown value for either refuses the whole save (nothing is written).
export async function setRankingRules(overdue: unknown, noDeadline: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isOverduePolicy(overdue)) return { ok: false, error: "Choose how to handle overdue applications." };
  if (!isNoDeadlinePolicy(noDeadline)) return { ok: false, error: "Choose how to handle applications with no deadline." };
  await setSetting(OVERDUE_KEY, overdue);
  await setSetting(NO_DEADLINE_KEY, noDeadline);
  return { ok: true };
}

export type PlannerItem = { id: number; title: string; trackId: number; trackName: string };
// `reasoning` = the FR-8.9 line ("Priority (+3), Heavy effort (+2), due in 5 days").
export type RankedItem = Scored & PlannerItem & { overdue: boolean; reasoning: string }; // score parts (score, daysLeft, priority, effort) + who it is; overdue = pinned and flagged
export type UndatedItem = PlannerItem & UndatedScore & { reasoning: string }; // buffer and daysUntouched

// "Last touched" (FR-8.6) = the later of the application's own updated_at and its newest note or activity event (when it was written, so a
// backdated manual submission does not count as the past). Every edit counts: form saves, archive/restore and table/board cell writes all bump updated_at. Ms per application id.
function lastTouchedMs(): Map<number, number> {
  const db = getDb();
  const userId = getUserId();
  const m = new Map<number, number>();
  const bump = (id: number, at: number | null) => { if (at !== null && at > (m.get(id) ?? 0)) m.set(id, at); };
  for (const r of db.select({ id: applications.id, at: applications.updatedAt }).from(applications).where(eq(applications.userId, userId)).all()) bump(r.id, r.at.getTime());
  const at = (c: unknown) => sql<number | null>`max(${c})`;
  for (const r of db.select({ id: notes.applicationId, at: at(notes.createdAt) }).from(notes).where(eq(notes.userId, userId)).groupBy(notes.applicationId).all()) bump(r.id, r.at);
  for (const r of db.select({ id: activityEvents.applicationId, at: at(activityEvents.createdAt) }).from(activityEvents).where(eq(activityEvents.userId, userId)).groupBy(activityEvents.applicationId).all()) bump(r.id, r.at);
  return m;
}

// Options of a slot column as the scoring module wants them (plus the label, for the reasoning); no column = none.
function scoreOptions(columnId: number | null): (ScoreOption & { label: string })[] {
  if (columnId === null) return [];
  return getDb()
    .select({ id: columnOptions.id, label: columnOptions.label, position: columnOptions.position, bufferDays: columnOptions.bufferDays })
    .from(columnOptions)
    .where(and(eq(columnOptions.columnId, columnId), eq(columnOptions.userId, getUserId())))
    .all();
}

type TodoTrack = { id: number; name: string; slots: SlotMapping; apps: PlannerApp[]; titles: Map<number, string> };

// The gathering below the policy step, shared by the ranking and the overdue alerts: per track, its non-archived applications in a
// still-to-do status (no status = never), with each one's slot values (FR-8.7). No overdue or no-deadline rule is applied here.
function gatherStillToDo(): TodoTrack[] {
  const db = getDb();
  const userId = getUserId();
  const out: TodoTrack[] = [];
  for (const t of db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.userId, userId)).orderBy(asc(tracks.position), asc(tracks.id)).all()) {
    const statusCol = db.select({ id: columns.id }).from(columns).where(and(eq(columns.trackId, t.id), eq(columns.isStatus, true), eq(columns.userId, userId))).get()?.id;
    const todo = new Set(stillToDoIds(t.id));
    if (statusCol === undefined || !todo.size) continue;
    const slots = resolveSlots(readSetting(plannerSlotsKey(t.id)), trackColumns(t.id));
    const wanted = [statusCol, ...[slots.priority, slots.deadline, slots.effort].filter((c): c is number => c !== null)];
    const cells = new Map<number, Map<number, { option: number | null; date: string | null }>>(); // application -> column -> value
    for (const c of db.select({ a: cellValues.applicationId, c: cellValues.columnId, option: cellValues.valueOptionId, date: cellValues.valueDate })
      .from(cellValues).where(and(eq(cellValues.userId, userId), inArray(cellValues.columnId, wanted))).all()) {
      const row = cells.get(c.a) ?? new Map();
      row.set(c.c, c);
      cells.set(c.a, row);
    }
    const titles = new Map<number, string>();
    const apps: PlannerApp[] = [];
    for (const a of db.select({ id: applications.id, title: applications.title }).from(applications)
      .where(and(eq(applications.trackId, t.id), eq(applications.userId, userId), eq(applications.archived, false))).orderBy(asc(applications.id)).all()) {
      const v = cells.get(a.id);
      const status = v?.get(statusCol)?.option ?? null;
      if (status === null || !todo.has(status)) continue;
      const at = (col: number | null) => (col === null ? undefined : v?.get(col));
      titles.set(a.id, a.title);
      apps.push({ id: a.id, deadline: at(slots.deadline)?.date ?? null, priority: at(slots.priority)?.option ?? null, effort: at(slots.effort)?.option ?? null });
    }
    out.push({ ...t, slots, apps, titles });
  }
  return out;
}

// FR-8: the still-to-do applications of every track, scored per track with that track's own Priority/Effort options (FR-8.7 fallback),
// then merged and ordered by the overdue and no-deadline rules (FR-8.5, FR-8.6).
// `undated` = no usable deadline, after every dated one, or empty when the rule says to leave them out.
export async function getPlannerRanking(today: string): Promise<{ ranked: RankedItem[]; undated: UndatedItem[] }> {
  const touched = lastTouchedMs();
  const rules = await getRankingRules();
  const ranked: (Scored & PlannerItem & { reasoning: string })[] = [];
  const undated: UndatedItem[] = [];
  for (const t of gatherStillToDo()) {
    const { slots, apps, titles } = t;
    const [po, eo] = [scoreOptions(slots.priority), scoreOptions(slots.effort)];
    const r = rankApplications(apps, today, po, eo);
    const who = (id: number) => ({ id, title: titles.get(id)!, trackId: t.id, trackName: t.name });
    const why = (b: Pick<Scored, "priority" | "effort">, daysLeft: number | null, daysUntouched: number | null) => reasoning({
      priority: { label: b.priority.fallback ? null : po.find((o) => o.id === b.priority.optionId)?.label ?? null, buffer: b.priority.buffer },
      effort: { label: eo.find((o) => o.id === b.effort.optionId)?.label ?? null, buffer: b.effort.buffer },
      daysLeft, daysUntouched,
    });
    for (const s of r.ranked) ranked.push({ ...s, ...who(s.app.id), reasoning: why(s, s.daysLeft, null) });
    for (const a of r.undated) {
      const u = undatedScore(a, localToday(new Date(touched.get(a.id) ?? 0)), today, po, eo);
      undated.push({ ...who(a.id), ...u, reasoning: why(u, null, rules.noDeadline === "stale" ? u.daysUntouched : null) });
    }
  }
  return orderRanking(ranked, undated, rules.overdue, rules.noDeadline);
}

// The still-to-do applications of every track with their Deadline slot value, from the ranking's own gathering (below its policy step, so the
// overdue and no-deadline rules never change it). React `cache` = once per request: the cards and the summary line share one pass, not one each.
const datedStillToDo = cache(() => gatherStillToDo().flatMap((t) => t.apps.map((a) => ({ id: a.id, title: t.titles.get(a.id)!, trackId: t.id, trackName: t.name, deadline: a.deadline }))));

// FR-9.5: those whose deadline is before today, most overdue first. The planner's overdue rule (pin, hide or normal) never changes it.
export const getOverdueAlerts = cache(async (today: string): Promise<OverdueAlert[]> => overdueAlerts(datedStillToDo(), today));

// FR-9.3: the nearest deadlines (today or later) across every track, from the same gathering as /planner (still-to-do, non-archived, each
// track's Deadline slot), so it can never disagree with it. No ranking is computed. Overdue is never in it.
export const getUpcomingDeadlines = cache(async (today: string, limit: number): Promise<UpcomingDeadline[]> => upcomingDeadlines(datedStillToDo(), today, limit));

// FR-9.4: submitted this week against capacity. The first-submission date of each non-archived application (one grouped
// query, MIN(date)) gives both this week's count and the streak (FR-9.4, `streak` in lib/dashboard.ts). Deleted files do not matter; the submission row stays.
export const getWeeklyProgress = cache(async (today: string): Promise<WeeklyProgress & { streak: number }> => {
  const userId = getUserId();
  const firstDates = getDb()
    .select({ first: sql<string>`min(${submissions.date})` })
    .from(submissions)
    .innerJoin(applications, eq(applications.id, submissions.applicationId))
    .where(and(eq(submissions.userId, userId), eq(applications.userId, userId), eq(applications.archived, false)))
    .groupBy(submissions.applicationId)
    .all()
    .map((r) => r.first);
  const capacity = await getCapacity();
  return { ...weeklyProgress(firstDates, capacity, today), streak: streak(firstDates, capacity, today).weeks };
});

export const CAPACITY_KEY = "planner.capacity";

// Weekly capacity in force (FR-8.8): saved whole number 1..50, else 4.
export async function getCapacity(): Promise<number> {
  return resolveCapacity(readSetting(CAPACITY_KEY));
}

// Saves the capacity; anything but a whole number 1..50 is refused and nothing is written.
export async function setCapacity(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const checked = checkCapacity(input);
  if ("error" in checked) return { ok: false, error: checked.error };
  await setSetting(CAPACITY_KEY, checked.capacity);
  return { ok: true };
}

// The whole ranking as one list: dated items, then the no-deadline ones placed by the rule. Shared by /planner, the settings preview and the plan.
export async function getPlannerList(today: string) {
  const { ranked, undated } = await getPlannerRanking(today);
  return [...ranked, ...undated.map((u) => ({ ...u, overdue: false }))];
}

// FR-8.8 / FR-9.1: `plan` = the top `capacity` of the list, `rest` = everything after it. The dashboard calls this too.
export async function getWeeksPlan(today: string) {
  const capacity = await getCapacity();
  return { capacity, ...weeksPlan(await getPlannerList(today), capacity) };
}

export type FollowUpItem = PlannerItem & { followUp: string; daysAgo: number; text: string };

// FR-8.10 / FR-9.2: submitted, non-archived applications of every track whose follow-up date (that track's Follow-up slot; no slot = nothing)
// is today or earlier, oldest first. Submitted = at least one submission row (a deleted file does not remove it) or a submitted current status.
// Independent of the ranking: no priority, deadline or still-to-do setting is read. The dashboard calls this too.
export async function getFollowUpsDue(today: string): Promise<FollowUpItem[]> {
  const db = getDb();
  const userId = getUserId();
  const withSubmission = new Set(db.select({ id: submissions.applicationId }).from(submissions).where(eq(submissions.userId, userId)).all().map((r) => r.id));
  const all: (FollowUpInput & PlannerItem & { followUp: string })[] = [];
  for (const t of db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.userId, userId)).orderBy(asc(tracks.position), asc(tracks.id)).all()) {
    const col = resolveSlots(readSetting(plannerSlotsKey(t.id)), trackColumns(t.id)).followUp;
    if (col === null) continue;
    const statusCol = db.select({ id: columns.id }).from(columns).where(and(eq(columns.trackId, t.id), eq(columns.isStatus, true), eq(columns.userId, userId))).get()?.id;
    const submitted = new Set(submittedStatusIds(t.id));
    const cells = new Map<string, { option: number | null; date: string | null }>(); // "application:column" -> value
    for (const c of db.select({ a: cellValues.applicationId, c: cellValues.columnId, option: cellValues.valueOptionId, date: cellValues.valueDate })
      .from(cellValues).where(and(eq(cellValues.userId, userId), inArray(cellValues.columnId, statusCol === undefined ? [col] : [col, statusCol]))).all()) cells.set(`${c.a}:${c.c}`, c);
    for (const a of db.select({ id: applications.id, title: applications.title }).from(applications)
      .where(and(eq(applications.trackId, t.id), eq(applications.userId, userId), eq(applications.archived, false))).orderBy(asc(applications.id)).all()) {
      const status = statusCol === undefined ? null : cells.get(`${a.id}:${statusCol}`)?.option ?? null;
      all.push({ id: a.id, title: a.title, trackId: t.id, trackName: t.name, followUp: cells.get(`${a.id}:${col}`)?.date ?? "", hasSubmission: withSubmission.has(a.id), submittedStatus: status !== null && submitted.has(status) });
    }
  }
  return followUpsDue(all, today).map(({ id, title, trackId, trackName, followUp, daysAgo, text }) => ({ id, title, trackId, trackName, followUp, daysAgo, text }));
}

// FR-8.11: back to the shipped planner settings, in one transaction. Deletes the saved slots and still-to-do list of every track and the three
// global keys (so the pure defaults apply), then sets the buffers on the options of the Priority and Effort columns those defaults now pick.
// Nothing else is touched (submitted statuses, labels, files and backup settings, options' labels/colours/order, cells, applications).
export async function resetPlannerSettings(): Promise<void> {
  const db = getDb();
  const userId = getUserId();
  db.transaction((tx) => { // same connection as getDb(): the reads below see the deletes
    const ids = tx.select({ id: tracks.id }).from(tracks).where(eq(tracks.userId, userId)).all().map((t) => t.id);
    const keys = [OVERDUE_KEY, NO_DEADLINE_KEY, CAPACITY_KEY, ...ids.flatMap((id) => [plannerSlotsKey(id), stillToDoKey(id)])];
    tx.delete(settings).where(and(eq(settings.userId, userId), inArray(settings.key, keys))).run();
    for (const id of ids) {
      const slots = resolveSlots(undefined, trackColumns(id));
      for (const slot of ["priority", "effort"] as const) {
        const col = slots[slot];
        if (col === null) continue;
        for (const o of tx.select({ id: columnOptions.id, label: columnOptions.label }).from(columnOptions).where(and(eq(columnOptions.columnId, col), eq(columnOptions.userId, userId))).all()) {
          tx.update(columnOptions).set({ bufferDays: defaultBuffer(slot, o.label), updatedAt: new Date() }).where(eq(columnOptions.id, o.id)).run();
        }
      }
    }
  });
}
