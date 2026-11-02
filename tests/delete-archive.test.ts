import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { archiveApplication as archiveAction, deleteApplication as deleteAction } from "@/app/actions/application-state";
import { archiveApplication, deleteApplication, getApplicationDetail, getDeleteImpact, listApplicationRows } from "@/lib/db/applications";
import { setCellValue } from "@/lib/db/cells";
import { applications, cellValues, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let trackId: number;
let textCol: number;
let numCol: number;
const mkApp = (title: string) => db.insert(applications).values({ userId: "local", trackId, title }).returning().get().id;
// Another user's track, application and cell value.
function otherUsersApp() {
  const t = db.insert(tracks).values({ userId: "other", name: "X", position: 0 }).returning().get().id;
  const c = db.insert(columns).values({ userId: "other", trackId: t, name: "c", type: "text", position: 0 }).returning().get().id;
  const a = db.insert(applications).values({ userId: "other", trackId: t, title: "Theirs" }).returning().get().id;
  db.insert(cellValues).values({ userId: "other", applicationId: a, columnId: c, valueText: "v" }).run();
  return a;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  textCol = db.insert(columns).values({ userId: "local", trackId, name: "t", type: "text", position: 0 }).returning().get().id;
  numCol = db.insert(columns).values({ userId: "local", trackId, name: "n", type: "number", position: 1 }).returning().get().id;
});
afterEach(dropTestDb);

describe("archive", () => {
  it("hides from the track rows, unarchive restores, detail still loads", async () => {
    const id = mkApp("A");
    expect(await archiveApplication(id, true)).toBe(true);
    expect(await listApplicationRows(trackId)).toEqual([]);
    expect((await getApplicationDetail(id))?.archived).toBe(true);
    expect(await archiveApplication(id, false)).toBe(true);
    expect((await listApplicationRows(trackId)).map((r) => r.id)).toEqual([id]);
  });

  it("does not touch another user's or a missing application", async () => {
    const theirs = otherUsersApp();
    expect(await archiveApplication(theirs, true)).toBe(false);
    expect(await archiveApplication(9999, true)).toBe(false);
    expect(db.select().from(applications).all().find((a) => a.id === theirs)?.archived).toBe(false);
  });

  it("action validates arguments and refreshes only on success", async () => {
    const id = mkApp("A");
    expect(await archiveAction(id, "yes" as unknown as boolean)).toEqual({ ok: false, error: "Application not found." });
    expect(await archiveAction(0, true)).toEqual({ ok: false, error: "Application not found." });
    expect(await archiveAction(9999, true)).toEqual({ ok: false, error: "Application not found." });
    expect(refresh).not.toHaveBeenCalled();
    expect(await archiveAction(id, true)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("getDeleteImpact", () => {
  it("counts stored cell values (blank = none), files are 0, title included", async () => {
    const id = mkApp("Acme");
    expect(await getDeleteImpact(id)).toEqual({ title: "Acme", cellCount: 0, fileCount: 0 });
    await setCellValue(id, textCol, "x");
    await setCellValue(id, numCol, "3");
    await setCellValue(id, numCol, ""); // blank deletes the row
    expect(await getDeleteImpact(id)).toEqual({ title: "Acme", cellCount: 1, fileCount: 0 });
  });

  it("is null for another user's or a missing application", async () => {
    expect(await getDeleteImpact(otherUsersApp())).toBeNull();
    expect(await getDeleteImpact(9999)).toBeNull();
  });
});

describe("delete", () => {
  it("removes the application and its cell values only, returns the track id", async () => {
    const id = mkApp("A");
    const keep = mkApp("B");
    await setCellValue(id, textCol, "x");
    await setCellValue(keep, textCol, "y");
    expect(await deleteApplication(id)).toBe(trackId);
    expect(await getApplicationDetail(id)).toBeNull();
    expect(db.select().from(cellValues).all().map((c) => c.applicationId)).toEqual([keep]);
  });

  it("does not delete another user's or a missing application", async () => {
    const theirs = otherUsersApp();
    expect(await deleteApplication(theirs)).toBeNull();
    expect(await deleteApplication(9999)).toBeNull();
    expect(db.select().from(applications).all().some((a) => a.id === theirs)).toBe(true);
    expect(db.select().from(cellValues).all()).toHaveLength(1);
  });

  it("action rejects anything but confirm === true and deletes nothing", async () => {
    const id = mkApp("A");
    await setCellValue(id, textCol, "x");
    for (const bad of [false, undefined, "true", 1, null, {}]) {
      expect(await deleteAction(id, bad as unknown as boolean)).toEqual({ ok: false, error: "Deleting must be confirmed." });
    }
    expect(await getApplicationDetail(id)).not.toBeNull();
    expect(db.select().from(cellValues).all()).toHaveLength(1);
  });

  it("action with confirmation deletes and returns the track id; bad ids and other users fail", async () => {
    const id = mkApp("A");
    expect(await deleteAction("1" as unknown as number, true)).toEqual({ ok: false, error: "Application not found." });
    expect(await deleteAction(otherUsersApp(), true)).toEqual({ ok: false, error: "Application not found." });
    expect(await deleteAction(id, true)).toEqual({ ok: true, trackId });
    expect(await deleteAction(id, true)).toEqual({ ok: false, error: "Application not found." });
    expect(await getApplicationDetail(id)).toBeNull();
  });
});
