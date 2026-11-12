import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveOptionBuffer } from "@/app/actions/settings";
import { getPlannerBuffers, setOptionBuffer, setPlannerSlots } from "@/lib/db/planner";
import { columnOptions, columns, tracks, type ColumnType } from "@/lib/db/schema";
import { checkBuffer, parseBufferInput } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
afterEach(dropTestDb);

const EMPTY = { priority: null, deadline: null, effort: null, followUp: null };

describe("checkBuffer", () => {
  it("accepts whole days 0..365 and null; refuses everything else", () => {
    for (const ok of [0, 1, 365]) expect(checkBuffer(ok)).toEqual({ days: ok });
    expect(checkBuffer(null)).toEqual({ days: null });
    for (const bad of [-1, 366, 1.5, NaN, Infinity, "3", "", undefined, {}, true]) expect(checkBuffer(bad)).toHaveProperty("error");
  });
});

describe("parseBufferInput", () => {
  it("digits become a number, blank becomes null, anything else stays text and is refused", () => {
    expect(parseBufferInput("")).toBeNull();
    expect(parseBufferInput("  ")).toBeNull();
    expect(parseBufferInput("3")).toBe(3);
    expect(parseBufferInput(" 4 ")).toBe(4);
    for (const bad of ["3-", "-", "e", "1e2", "1.5", "-1", "+3", "abc"]) {
      expect(parseBufferInput(bad)).toBe(bad);
      expect(checkBuffer(parseBufferInput(bad))).toHaveProperty("error");
    }
    expect(checkBuffer(parseBufferInput("366"))).toHaveProperty("error");
  });
});

describe("option buffers data layer", () => {
  const track = (name: string, position = 0) => db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
  const col = (trackId: number, name: string, type: ColumnType, position = 0) =>
    db.insert(columns).values({ userId: "local", trackId, name, type, position }).returning().get().id;
  const opt = (columnId: number, label: string, position: number, bufferDays?: number, userId = "local") =>
    db.insert(columnOptions).values({ userId, columnId, label, color: "blue", position, bufferDays }).returning().get().id;
  const days = (id: number) => db.select().from(columnOptions).where(eq(columnOptions.id, id)).get()!.bufferDays;

  it("lists the options of the Priority and Effort slot columns in order; empty slots are null", async () => {
    const t = track("Job");
    const p = col(t, "Priority", "single_select", 0);
    const b = opt(p, "Low", 1), a = opt(p, "High", 0, 3);
    expect(await getPlannerBuffers(t)).toEqual({
      priority: { column: "Priority", options: [{ id: a, label: "High", color: "blue", bufferDays: 3 }, { id: b, label: "Low", color: "blue", bufferDays: null }] },
      effort: null,
    });
  });

  it("sets, changes and clears a buffer", async () => {
    const t = track("Job");
    const o = opt(col(t, "Priority", "single_select"), "High", 0);
    expect(await setOptionBuffer(o, 5)).toEqual({ ok: true });
    expect(days(o)).toBe(5);
    expect(await setOptionBuffer(o, 0)).toEqual({ ok: true });
    expect(days(o)).toBe(0);
    expect(await setOptionBuffer(o, null)).toEqual({ ok: true });
    expect(days(o)).toBeNull();
  });

  it("refuses non-integers and out-of-range values and changes nothing", async () => {
    const t = track("Job");
    const o = opt(col(t, "Priority", "single_select"), "High", 0, 3);
    for (const bad of [1.5, -1, 366, "4", NaN, undefined]) expect(await setOptionBuffer(o, bad)).toMatchObject({ ok: false });
    expect(days(o)).toBe(3);
  });

  it("refuses an unknown option, another user's option, and a non-integer id", async () => {
    const t = track("Job");
    const p = col(t, "Priority", "single_select");
    const mine = opt(p, "High", 0, 3);
    const theirs = opt(p, "Theirs", 1, 3, "someone-else");
    expect(await setOptionBuffer(999, 1)).toEqual({ ok: false, error: "Option not found." });
    expect(await setOptionBuffer(theirs, 1)).toEqual({ ok: false, error: "Option not found." });
    expect(await setOptionBuffer("1" as unknown, 1)).toEqual({ ok: false, error: "Option not found." });
    expect(days(theirs)).toBe(3);
    expect(days(mine)).toBe(3);
  });

  it("refuses an option whose column is not the current Priority or Effort slot", async () => {
    const t = track("Job");
    const p = col(t, "Priority", "single_select", 0), status = col(t, "Status", "single_select", 1), other = col(t, "Other", "single_select", 2);
    const inStatus = opt(status, "To apply", 0), inOther = opt(other, "X", 0), inPriority = opt(p, "High", 0);
    expect(await setOptionBuffer(inStatus, 1)).toMatchObject({ ok: false, error: expect.stringContaining("Priority or Effort") });
    expect(await setOptionBuffer(inOther, 1)).toMatchObject({ ok: false });
    expect(days(inStatus)).toBeNull();
    // Re-map the Priority slot to Other: now Other's options accept a buffer and the old Priority column's do not.
    expect(await setPlannerSlots(t, { ...EMPTY, priority: other })).toEqual({ ok: true });
    expect(await setOptionBuffer(inOther, 2)).toEqual({ ok: true });
    expect(await setOptionBuffer(inPriority, 2)).toMatchObject({ ok: false });
    expect((await getPlannerBuffers(t)).priority).toMatchObject({ column: "Other" });
  });

  it("an option of another track's column is refused", async () => {
    const t = track("Job"), o = track("PhD", 1);
    col(t, "Priority", "single_select");
    const x = opt(col(o, "Misc", "single_select"), "X", 0);
    expect(await setOptionBuffer(x, 1)).toMatchObject({ ok: false });
  });

  it("the action refreshes only after a successful save", async () => {
    const t = track("Job");
    const o = opt(col(t, "Effort", "single_select"), "Heavy", 0);
    expect(await saveOptionBuffer(o, 2)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveOptionBuffer(o, 1.5)).toMatchObject({ ok: false });
    expect(await saveOptionBuffer("junk", 1)).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(days(o)).toBe(2);
  });
});
