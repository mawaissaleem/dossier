import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createApplication } from "@/app/actions/applications";
import { setStatusColumn, setColumnDefault } from "@/app/actions/columns";
import { getApplicationDetail } from "@/lib/db/applications";
import { listColumns } from "@/lib/db/columns";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let status: number, stage: number, text: number; // status + stage are single_select, text is not
let toApply: number, applied: number, open: number;
const col = (name: string, type: "text" | "single_select", position: number, extra: Partial<typeof columns.$inferInsert> = {}, tid = trackId, userId = "local") =>
  db.insert(columns).values({ userId, trackId: tid, name, type, position, ...extra }).returning().get().id;
const opt = (columnId: number, label: string, position: number, userId = "local") =>
  db.insert(columnOptions).values({ userId, columnId, label, color: "blue", position }).returning().get().id;
const row = (id: number) => db.select().from(columns).where(eq(columns.id, id)).get()!;
const statusIds = () => db.select().from(columns).where(eq(columns.trackId, trackId)).all().filter((c) => c.isStatus).map((c) => c.id);
// The status cell of a new application, as the option label (null = blank).
async function statusOf(appId: number) {
  const v = (await getApplicationDetail(appId))!.values[status];
  return v === null ? null : db.select().from(columnOptions).where(eq(columnOptions.id, v as number)).get()!.label;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  status = col("Status", "single_select", 0, { isStatus: true });
  stage = col("Stage", "single_select", 1);
  text = col("Notes", "text", 2);
  toApply = opt(status, "To apply", 0);
  applied = opt(status, "Applied", 1);
  open = opt(stage, "Open", 0);
  db.update(columns).set({ defaultValue: String(toApply) }).where(eq(columns.id, status)).run();
});
afterEach(dropTestDb);

describe("setStatusColumn", () => {
  it("moves the flag, keeps one per track, and leaves both columns' defaults with their columns", async () => {
    db.update(columns).set({ defaultValue: String(open) }).where(eq(columns.id, stage)).run();
    expect(await setStatusColumn(trackId, stage)).toEqual({ ok: true });
    expect(statusIds()).toEqual([stage]);
    expect(row(status).defaultValue).toBe(String(toApply));
    expect(row(stage).defaultValue).toBe(String(open));
    expect((await listColumns(trackId)).find((c) => c.isStatus)?.id).toBe(stage);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not touch another track's status column", async () => {
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const s2 = col("Status", "single_select", 0, { isStatus: true }, t2);
    await setStatusColumn(trackId, stage);
    expect(row(s2).isStatus).toBe(true);
  });

  it("is a no-op on the current status column", async () => {
    expect(await setStatusColumn(trackId, status)).toEqual({ ok: true });
    expect(statusIds()).toEqual([status]);
    expect(row(status).defaultValue).toBe(String(toApply));
  });

  it("rejects non-select columns, a select without options, wrong track, missing and bad ids; nothing changes", async () => {
    const empty = col("Empty", "single_select", 3);
    const t2 = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
    const before = JSON.stringify(db.select().from(columns).all());
    expect((await setStatusColumn(trackId, text)).ok).toBe(false);
    expect((await setStatusColumn(trackId, empty)).ok).toBe(false);
    expect(await setStatusColumn(t2, stage)).toEqual({ ok: false, error: "Column not found." });
    expect(await setStatusColumn(trackId, 9999)).toEqual({ ok: false, error: "Column not found." });
    for (const bad of [0, -1, 1.5, "1", NaN]) expect(await setStatusColumn(trackId, bad as number)).toEqual({ ok: false, error: "Column not found." });
    expect(JSON.stringify(db.select().from(columns).all())).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects another user's column", async () => {
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = col("S", "single_select", 0, {}, t2, "someone-else");
    opt(foreign, "A", 0, "someone-else");
    expect(await setStatusColumn(t2, foreign)).toEqual({ ok: false, error: "Column not found." });
    expect(row(foreign).isStatus).toBe(false);
  });
});

describe("setColumnDefault on the Status column", () => {
  it("sets and clears the default (option id as text)", async () => {
    expect(await setColumnDefault(status, applied)).toEqual({ ok: true });
    expect(row(status).defaultValue).toBe(String(applied));
    expect(await setColumnDefault(status, null)).toEqual({ ok: true });
    expect(row(status).defaultValue).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("rejects an option of another column, a missing or foreign option, and bad ids", async () => {
    const before = row(status).defaultValue;
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreignCol = col("S", "single_select", 0, {}, t2, "someone-else");
    const foreignOpt = opt(foreignCol, "A", 0, "someone-else");
    for (const o of [open, 9999, foreignOpt, 0, 1.5, true]) expect((await setColumnDefault(status, o as number)).ok).toBe(false);
    expect(await setColumnDefault(0, applied)).toEqual({ ok: false, error: "Column not found." });
    expect(row(status).defaultValue).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is the same mechanism for a non-status column, and rejects other users' columns", async () => {
    expect(await setColumnDefault(stage, open)).toEqual({ ok: true });
    expect(row(stage).defaultValue).toBe(String(open));
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = col("S", "single_select", 0, { isStatus: true }, t2, "someone-else");
    const fo = opt(foreign, "A", 0, "someone-else");
    expect(await setColumnDefault(foreign, fo)).toEqual({ ok: false, error: "Column not found." });
    expect(row(foreign).defaultValue).toBeNull();
  });
});

describe("createApplication default status", () => {
  it("pre-fills the default status, then follows a changed default", async () => {
    const a = await createApplication("A", trackId);
    expect(a.ok && (await statusOf(a.id))).toBe("To apply");
    await setColumnDefault(status, applied);
    const b = await createApplication("B", trackId);
    expect(b.ok && (await statusOf(b.id))).toBe("Applied");
    expect(db.select().from(cellValues).all()).toHaveLength(2); // only the status cell, no other blank rows
  });

  it("no default leaves the status blank and writes no cell", async () => {
    await setColumnDefault(status, null);
    const r = await createApplication("A", trackId);
    expect(r.ok && (await statusOf(r.id))).toBeNull();
    expect(db.select().from(cellValues).all()).toHaveLength(0);
  });

  it.each([
    ["an option deleted by hand", () => String(9999)],
    ["an option of another column", () => String(open)],
    ["non-numeric text", () => "To apply"],
    ["an empty string", () => ""],
  ])("a dangling default (%s) is ignored: application created blank", async (_n, value) => {
    db.update(columns).set({ defaultValue: value() }).where(eq(columns.id, status)).run();
    const r = await createApplication("A", trackId);
    expect(r.ok).toBe(true);
    expect(r.ok && (await statusOf(r.id))).toBeNull();
    expect(db.select().from(applications).all()).toHaveLength(1);
  });

  it("after the status column is replaced, each default stays with its own column", async () => {
    await setStatusColumn(trackId, stage);
    const a = await createApplication("A", trackId);
    expect(a.ok && db.select().from(cellValues).where(eq(cellValues.applicationId, a.id)).all().map((c) => c.columnId)).toEqual([status]); // stage has none yet
    await setColumnDefault(stage, open);
    const b = await createApplication("B", trackId);
    expect(b.ok && db.select().from(cellValues).where(eq(cellValues.applicationId, b.id)).all().map((c) => c.columnId).sort()).toEqual([status, stage].sort());
  });

  it("another user's track creates nothing, default or not", async () => {
    const t2 = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 0 }).returning().get().id;
    const foreign = col("S", "single_select", 0, { isStatus: true }, t2, "someone-else");
    db.update(columns).set({ defaultValue: String(opt(foreign, "A", 0, "someone-else")) }).where(eq(columns.id, foreign)).run();
    expect(await createApplication("A", t2)).toEqual({ ok: false, error: "Track not found." });
    expect(db.select().from(applications).all()).toHaveLength(0);
    expect(db.select().from(cellValues).all()).toHaveLength(0);
  });
});
