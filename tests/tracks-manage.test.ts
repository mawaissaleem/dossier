import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "@/lib/db/applications";
import { activityEvents, applications, cellValues, columnOptions, columns, files, notes, settings, submissionFiles, submissions, tracks } from "@/lib/db/schema";
import { createTrackFromTemplate, deleteTrack, getStarredTrackIds, getTrackDeleteImpact, listTracks, setTrackStarred, updateTrack } from "@/lib/db/tracks";
import { setExpectedLabels, getExpectedLabels, getSubmittedStatuses } from "@/lib/db/track-settings";
import { setSetting } from "@/lib/db/settings";
import { PALETTE } from "@/lib/colors";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";
import { trackSnapshot } from "./helpers/snapshot";
import seeded from "./fixtures/seed-snapshot.json";

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { db = useTestDb(); });
afterEach(dropTestDb);

const add = async (name: string, template: string) => {
  const r = await createTrackFromTemplate(name, template);
  if (!r.ok) throw new Error(r.error);
  return r.id;
};

describe("a fresh database", () => {
  it("has no tracks", async () => {
    expect(await listTracks()).toEqual([]);
    expect(await getStarredTrackIds()).toEqual(new Set());
  });
});

describe("createTrackFromTemplate", () => {
  it("Job then PhD build exactly what the seed always built (fixture taken from the old seed script)", async () => {
    await add("Job", "job");
    await add("PhD", "phd");
    expect(JSON.parse(JSON.stringify(trackSnapshot()))).toEqual(seeded);
  });

  it("npm run db:seed makes the same tracks as adding the templates", async () => {
    runSeed();
    expect(JSON.parse(JSON.stringify(trackSnapshot()))).toEqual(seeded);
    expect((await listTracks()).map((t) => t.color)).toEqual([PALETTE[0], PALETTE[1]]); // what the dialog would pick for the first two
  });

  it("Blank has one Status column with five options, and the default settings", async () => {
    await add("Mine", "blank");
    const [t] = trackSnapshot();
    expect(t).toMatchObject({ name: "Mine", expectedLabels: [], submitted: ["Applied"], wins: ["Interview", "Offer"], stillToDo: ["To apply"] });
    expect(t.columns).toHaveLength(1);
    expect(t.columns[0]).toMatchObject({ name: "Status", type: "single_select", isStatus: true, default: "To apply" });
    expect(t.columns[0].options.map((o) => o.label)).toEqual(["To apply", "Applied", "Interview", "Offer", "Rejected"]);
  });

  it("can add a template twice under different names, each with its own columns and settings", async () => {
    const a = await add("Job", "job");
    const b = await add("Job – Europe", "job");
    expect(db.select().from(columns).all().filter((c) => c.trackId === b)).toHaveLength(9);
    expect(await getExpectedLabels(b)).toEqual(["CV", "Cover letter"]);
    expect((await getSubmittedStatuses(a))[0]).not.toBe((await getSubmittedStatuses(b))[0]);
  });

  it("puts new tracks last, and picks colours that differ", async () => {
    await add("A", "blank");
    await add("B", "blank");
    await add("C", "blank");
    const list = await listTracks();
    expect(list.map((t) => t.name)).toEqual(["A", "B", "C"]);
    expect(list.map((t) => t.position)).toEqual([0, 1, 2]);
    expect(new Set(list.map((t) => t.color)).size).toBe(3);
  });

  it("goes after the highest position even when an earlier track was deleted", async () => {
    const a = await add("A", "blank");
    await add("B", "blank");
    await deleteTrack(a, "A", (await getTrackDeleteImpact(a))!);
    const c = await add("C", "blank");
    expect((await listTracks()).find((t) => t.id === c)!.position).toBe(2);
  });

  it("refuses a used name (any case), a blank or over-long name and an unknown template, and writes nothing", async () => {
    await add("Job", "job");
    const before = JSON.stringify(trackSnapshot());
    for (const [name, template] of [["job", "job"], [" JOB ", "blank"], ["", "job"], ["  ", "job"], ["x".repeat(61), "job"], ["Fine", "nope"], ["Fine", "constructor"]]) {
      expect(await createTrackFromTemplate(name, template)).toMatchObject({ ok: false });
    }
    expect(JSON.stringify(trackSnapshot())).toBe(before);
  });

  it("trims the name and keeps the other user's tracks out of the uniqueness check", async () => {
    db.insert(tracks).values({ userId: "someone-else", name: "Taken", position: 0 }).run();
    const id = await add("  Taken  ", "blank");
    expect((await listTracks()).find((t) => t.id === id)!.name).toBe("Taken");
    expect(await listTracks()).toHaveLength(1);
  });

  it("gives a track saved before colours existed (null) a colour from its id", async () => {
    const t = db.insert(tracks).values({ userId: "local", name: "Old", position: 0 }).returning().get();
    expect(t.color).toBeNull();
    expect(PALETTE).toContain((await listTracks())[0].color);
    const id = await add("New", "blank");
    expect((await listTracks()).find((x) => x.id === id)!.color).not.toBe((await listTracks())[0].color);
  });
});

describe("updateTrack", () => {
  it("renames and recolours, keeping everything else", async () => {
    const id = await add("Job", "job");
    const before = db.select().from(columns).all().length;
    expect(await updateTrack(id, "  Work ", "teal")).toEqual({ ok: true });
    expect((await listTracks())[0]).toMatchObject({ name: "Work", color: "teal" });
    expect(db.select().from(columns).all()).toHaveLength(before);
  });
  it("lets a track keep its own name (also in another case) but not take another's", async () => {
    const a = await add("Job", "blank");
    await add("PhD", "blank");
    expect(await updateTrack(a, "JOB", "red")).toEqual({ ok: true });
    expect(await updateTrack(a, "phd", "red")).toMatchObject({ ok: false });
    expect((await listTracks())[0].name).toBe("JOB");
  });
  it("refuses a bad colour, a blank name, another user's track and a missing track, changing nothing", async () => {
    const id = await add("Job", "blank");
    const other = db.insert(tracks).values({ userId: "someone-else", name: "Other", position: 0 }).returning().get().id;
    const before = JSON.stringify(db.select().from(tracks).all());
    for (const [t, name, color] of [[id, "Job", "#ff0000"], [id, "Job", "pink"], [id, " ", "red"], [other, "X", "red"], [9999, "X", "red"]] as [number, string, string][]) {
      expect(await updateTrack(t, name, color)).toMatchObject({ ok: false });
    }
    expect(JSON.stringify(db.select().from(tracks).all())).toBe(before);
  });
});

describe("deleting a track", () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), "dossier-trackdel-")); });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  // One application with a value, a note, a submission listing a stored file, plus a second file and an archived application; files really exist on disk.
  async function fill(trackId: number, tag: string) {
    const r = await createApplication({ title: `Acme ${tag}`, trackId, values: [] });
    if (!r.ok) throw new Error(r.error);
    const colId = db.select().from(columns).all().find((c) => c.trackId === trackId && c.isStatus)!.id;
    const opt = db.select().from(columnOptions).all().find((o) => o.columnId === colId)!.id;
    db.insert(cellValues).values({ userId: "local", applicationId: r.id, columnId: colId, valueOptionId: opt }).onConflictDoNothing().run();
    db.insert(notes).values({ userId: "local", applicationId: r.id, body: "hello" }).run();
    const file = (name: string) => {
      const path = join(base, `${tag}-${name}`);
      writeFileSync(path, "bytes");
      return db.insert(files).values({ userId: "local", applicationId: r.id, label: "CV", originalName: name, storedName: name, relativePath: `${tag}-${name}`, sha256: "a".repeat(64), sizeBytes: 5, uploadDate: "2026-11-08", baseName: name, extension: "pdf", seq: 1 }).returning().get().id;
    };
    const f1 = file("cv");
    file("letter");
    const s = db.insert(submissions).values({ userId: "local", applicationId: r.id, date: "2026-11-08" }).returning().get().id;
    db.insert(submissionFiles).values({ userId: "local", submissionId: s, fileId: f1 }).run();
    db.insert(activityEvents).values({ userId: "local", applicationId: r.id, kind: "file_uploaded", fileId: f1, submissionId: s }).run();
    const arch = await createApplication({ title: `Archived ${tag}`, trackId, values: [] });
    if (!arch.ok) throw new Error(arch.error);
    db.update(applications).set({ archived: true }).where(eq(applications.id, arch.id)).run();
    return join(base, `${tag}-cv`);
  }

  it("counts what would be lost", async () => {
    const id = await add("Job", "job");
    await fill(id, "a");
    expect(await getTrackDeleteImpact(id)).toEqual({ name: "Job", applications: 2, columns: 9, submissions: 1, notes: 1, files: 2 });
    expect(await getTrackDeleteImpact(9999)).toBeNull();
    db.insert(tracks).values({ userId: "someone-else", name: "Other", position: 0 }).run();
    expect(await getTrackDeleteImpact(db.select().from(tracks).all().find((t) => t.name === "Other")!.id)).toBeNull();
  });

  it("removes the track and its rows and settings, keeps the other track and the global settings, and leaves the files on disk", async () => {
    const a = await add("Job", "job");
    const b = await add("PhD", "phd");
    const onDisk = await fill(a, "a");
    await fill(b, "b");
    await setSetting("planner.overdue", "pin");
    await setSetting(`track.${a}.planner_slots`, { priority: 1 });
    await setSetting(`track.${a}.still_to_do`, [1]);
    await setSetting(`track.${a}0.expected_labels`, ["not ours"]); // another track's id starting with ours must survive
    const keep = JSON.stringify(trackSnapshot().filter((t) => t.name === "PhD"));
    const impact = (await getTrackDeleteImpact(a))!;

    expect(await deleteTrack(a, "Job", impact)).toEqual({ ok: true });

    expect((await listTracks()).map((t) => t.name)).toEqual(["PhD"]);
    expect(JSON.stringify(trackSnapshot())).toBe(keep);
    expect(db.select().from(settings).all().filter((s) => s.key.startsWith(`track.${a}.`))).toEqual([]);
    expect(db.select().from(settings).all().map((s) => s.key)).toEqual(expect.arrayContaining(["planner.overdue", `track.${a}0.expected_labels`, `track.${b}.expected_labels`]));
    expect(db.select().from(columns).all().every((c) => c.trackId === b)).toBe(true);
    expect(db.select().from(applications).all().every((x) => x.trackId === b)).toBe(true);
    expect(db.select().from(files).all().length).toBe(2); // PhD's two
    expect(db.select().from(submissions).all()).toHaveLength(1);
    expect(db.select().from(notes).all()).toHaveLength(1);
    expect(db.select().from(columnOptions).all().every((o) => db.select().from(columns).all().some((c) => c.id === o.columnId))).toBe(true);
    expect(existsSync(onDisk)).toBe(true);
    expect(await getTrackDeleteImpact(a)).toBeNull();
  });

  it("deletes an empty track too, and a second delete says not found", async () => {
    const id = await add("Blank", "blank");
    expect(await deleteTrack(id, "Blank", (await getTrackDeleteImpact(id))!)).toEqual({ ok: true });
    expect(await deleteTrack(id, "Blank", { applications: 0, columns: 1, submissions: 0, notes: 0, files: 0 })).toEqual({ ok: false, error: "Track not found." });
    expect(db.select().from(settings).all()).toEqual([]);
  });

  it("changes nothing without the exact typed name, with stale counts, or for another user's track", async () => {
    const id = await add("Job", "job");
    await fill(id, "a");
    const other = db.insert(tracks).values({ userId: "someone-else", name: "Other", position: 5 }).returning().get().id;
    const impact = (await getTrackDeleteImpact(id))!;
    const before = JSON.stringify([db.select().from(tracks).all(), db.select().from(settings).all(), db.select().from(files).all()]);
    expect(await deleteTrack(id, "job", impact)).toMatchObject({ ok: false });
    expect(await deleteTrack(id, "", impact)).toMatchObject({ ok: false });
    expect(await deleteTrack(id, "Job", { ...impact, notes: impact.notes + 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since/) });
    expect(await deleteTrack(id, "Job", { ...impact, applications: 0 })).toMatchObject({ ok: false });
    expect(await deleteTrack(other, "Other", { applications: 0, columns: 0, submissions: 0, notes: 0, files: 0 })).toEqual({ ok: false, error: "Track not found." });
    expect(JSON.stringify([db.select().from(tracks).all(), db.select().from(settings).all(), db.select().from(files).all()])).toBe(before);
  });

  it("rolls everything back when the delete fails part way", async () => {
    const id = await add("Job", "job");
    const impact = (await getTrackDeleteImpact(id))!;
    // A trigger that makes the track row's delete fail, after the settings were removed in the same transaction.
    db.$client.exec("CREATE TRIGGER no_delete BEFORE DELETE ON tracks BEGIN SELECT RAISE(ABORT, 'no'); END");
    await expect(deleteTrack(id, "Job", impact)).rejects.toThrow();
    expect(db.select().from(settings).all().filter((s) => s.key.startsWith(`track.${id}.`)).length).toBeGreaterThan(0);
    expect(await listTracks()).toHaveLength(1);
  });

  it("is reflected by the track list, the stars and expected labels reading", async () => {
    const id = await add("Job", "job");
    await setExpectedLabels(id, ["CV"]);
    await setTrackStarred(id, true);
    await deleteTrack(id, "Job", (await getTrackDeleteImpact(id))!);
    expect(await listTracks()).toEqual([]);
    expect(await getStarredTrackIds()).toEqual(new Set());
    expect(db.select().from(settings).all().filter((s) => s.key.includes("starred"))).toEqual([]); // the star went with the track's other settings
    expect(await getExpectedLabels(id)).toEqual([]);
  });
});

describe("starring a track", () => {
  it("stars and unstars; the star is one `track.<id>.starred` setting, removed again on unstar", async () => {
    const a = await add("Job", "job");
    const b = await add("PhD", "phd");
    expect(await getStarredTrackIds()).toEqual(new Set());
    expect(await setTrackStarred(a, true)).toEqual({ ok: true });
    expect(await setTrackStarred(a, true)).toEqual({ ok: true }); // starring twice is still one star
    await setTrackStarred(b, true);
    expect(await getStarredTrackIds()).toEqual(new Set([a, b]));
    expect(db.select().from(settings).all().filter((s) => s.key === `track.${a}.starred`)).toHaveLength(1);
    expect(await setTrackStarred(a, false)).toEqual({ ok: true });
    expect(await setTrackStarred(a, false)).toEqual({ ok: true });
    expect(await getStarredTrackIds()).toEqual(new Set([b]));
    expect(db.select().from(settings).all().filter((s) => s.key === `track.${a}.starred`)).toEqual([]);
  });

  it("refuses a missing track and another user's track, and writes nothing", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "Other", position: 5 }).returning().get().id;
    for (const id of [9999, other]) {
      expect(await setTrackStarred(id, true)).toEqual({ ok: false, error: "Track not found." });
      expect(await setTrackStarred(id, false)).toEqual({ ok: false, error: "Track not found." });
    }
    expect(db.select().from(settings).all()).toEqual([]);
  });

  it("only this user's `track.<id>.starred = true` rows count", async () => {
    const a = await add("Job", "job");
    db.insert(settings).values([
      { userId: "someone-else", key: `track.${a}.starred`, value: "true" },
      { userId: "local", key: "track.7.starred", value: "false" },
      { userId: "local", key: "track.8.starred", value: "not json" },
      { userId: "local", key: "track.9.starred_not", value: "true" },
    ]).run();
    expect(await getStarredTrackIds()).toEqual(new Set());
    await setTrackStarred(a, true);
    expect(await getStarredTrackIds()).toEqual(new Set([a]));
  });
});
