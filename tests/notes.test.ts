import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createNote } from "@/app/actions/notes";
import { addNote, listNotes } from "@/lib/db/notes";
import { applications, notes, tracks } from "@/lib/db/schema";
import { checkNoteBody, NOTE_BODY_MAX } from "@/lib/notes";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let appId: number;
let foreignApp: number;

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  const trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  appId = db.insert(applications).values({ userId: "local", trackId, title: "A" }).returning().get().id;
  foreignApp = db.insert(applications).values({ userId: "someone-else", trackId, title: "B" }).returning().get().id;
});
afterEach(dropTestDb);

describe("checkNoteBody", () => {
  it("trims, including Unicode whitespace, and keeps inner line breaks", () => {
    expect(checkNoteBody("   hi\n\nthere  ")).toEqual({ ok: true, body: "hi\n\nthere" });
  });
  it.each(["", "   ", "\n\t", " ", " ", "  ﻿", "​"])("refuses a blank body %j", (b) => {
    expect(checkNoteBody(b).ok).toBe(false);
  });
  it("refuses a non-string", () => {
    expect(checkNoteBody(null).ok).toBe(false);
    expect(checkNoteBody(5).ok).toBe(false);
  });
  it("accepts exactly the maximum and refuses one more (the limit counts the trimmed text)", () => {
    expect(checkNoteBody(`  ${"a".repeat(NOTE_BODY_MAX)}  `).ok).toBe(true);
    expect(checkNoteBody("a".repeat(NOTE_BODY_MAX + 1))).toEqual({ ok: false, error: expect.stringContaining("5,000") });
  });
});

describe("addNote / listNotes", () => {
  it("stores the trimmed body with user_id and a timestamp, and returns it", async () => {
    const r = await addNote(appId, "  called them\nnext week  ");
    expect(r).toMatchObject({ ok: true, note: { body: "called them\nnext week" } });
    const row = db.select().from(notes).get()!;
    expect(row).toMatchObject({ userId: "local", applicationId: appId, body: "called them\nnext week" });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it("lists newest first, ties by id, and only this application's notes", async () => {
    const other = db.insert(applications).values({ userId: "local", trackId: 1, title: "C" }).returning().get().id;
    const at = (t: number) => new Date(t);
    const mk = (applicationId: number, body: string, t: number) => db.insert(notes).values({ userId: "local", applicationId, body, createdAt: at(t) }).run();
    mk(appId, "old", 1000);
    mk(appId, "tie-first", 3000);
    mk(appId, "tie-second", 3000);
    mk(appId, "mid", 2000);
    mk(other, "elsewhere", 9000);
    expect((await listNotes(appId)).map((n) => n.body)).toEqual(["tie-second", "tie-first", "mid", "old"]);
    expect(await listNotes(99999)).toEqual([]);
  });

  it("refuses an unknown application and another user's application, writing nothing", async () => {
    expect(await addNote(99999, "x")).toEqual({ ok: false, error: "Application not found." });
    expect(await addNote(foreignApp, "x")).toEqual({ ok: false, error: "Application not found." });
    expect(db.select().from(notes).all()).toHaveLength(0);
  });

  it("does not list another user's notes", async () => {
    db.insert(notes).values({ userId: "someone-else", applicationId: appId, body: "secret" }).run();
    expect(await listNotes(appId)).toEqual([]);
  });

  it("refuses blank (incl. U+00A0) and over-long bodies with a body field error, writing nothing", async () => {
    expect(await addNote(appId, "  \n")).toMatchObject({ ok: false, field: "body" });
    expect(await addNote(appId, "a".repeat(NOTE_BODY_MAX + 1))).toMatchObject({ ok: false, field: "body" });
    expect(db.select().from(notes).all()).toHaveLength(0);
  });

  it("stores markup as plain text, unchanged", async () => {
    await addNote(appId, "<b>x</b> **y**");
    expect(db.select().from(notes).where(eq(notes.applicationId, appId)).get()?.body).toBe("<b>x</b> **y**");
  });
});

describe("createNote action", () => {
  it("adds the note and refreshes", async () => {
    expect(await createNote(appId, "hello")).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(db.select().from(notes).all()).toHaveLength(1);
  });

  it.each([0, -1, 1.5, NaN, "1", null, undefined])("refuses application id %j without touching the data or refreshing", async (id) => {
    const r = await createNote(id as number, "hello");
    expect(r).toMatchObject({ ok: false });
    expect(refresh).not.toHaveBeenCalled();
    expect(db.select().from(notes).all()).toHaveLength(0);
  });

  it("refuses a non-string body and a blank one with a body field error, without refreshing", async () => {
    expect(await createNote(appId, 5 as unknown as string)).toMatchObject({ ok: false, field: "body" });
    expect(await createNote(appId, " ")).toMatchObject({ ok: false, field: "body" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh when the application is not the user's", async () => {
    expect(await createNote(foreignApp, "x")).toMatchObject({ ok: false, error: "Application not found." });
    expect(refresh).not.toHaveBeenCalled();
  });
});
