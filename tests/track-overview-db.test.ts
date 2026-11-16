import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStillToDo } from "@/lib/db/planner";
import { applications, cellValues, columnOptions, columns, notes, submissions, tracks, type ColumnType } from "@/lib/db/schema";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { listTrackCounts } from "@/lib/db/tracks";
import { dropTestDb, useTestDb } from "./helpers/db";

const DAY = 86_400_000;
const TODAY = "2026-11-17";
const NOW = Date.UTC(2026, 10, 17, 12);

describe("getTrackOverviews and listTrackCounts (data layer)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  const col = (trackId: number, name: string, type: ColumnType, position: number, isStatus = false, userId = "local") =>
    db.insert(columns).values({ userId, trackId, name, type, position, isStatus }).returning().get().id;
  function track(name: string, position: number) {
    const t = db.insert(tracks).values({ userId: "local", name, position }).returning().get().id;
    const status = col(t, "Status", "single_select", 0, true);
    const opt = (label: string, p: number) => db.insert(columnOptions).values({ userId: "local", columnId: status, label, color: "blue", position: p }).returning().get().id;
    const [toApply, applied, interview] = [opt("To apply", 0), opt("Applied", 1), opt("Interview", 2)];
    const dl = col(t, "Deadline", "date", 1);
    const add = (title: string, s: number | null, o: { deadline?: string; touchedDaysAgo?: number; archived?: boolean; userId?: string } = {}) => {
      const at = new Date(NOW - (o.touchedDaysAgo ?? 1) * DAY);
      const a = db.insert(applications).values({ userId: o.userId ?? "local", trackId: t, title, archived: o.archived ?? false, createdAt: at, updatedAt: at }).returning().get().id;
      if (s !== null) db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: status, valueOptionId: s }).run();
      if (o.deadline) db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: dl, valueDate: o.deadline }).run();
      return a;
    };
    return { t, toApply, applied, interview, add };
  }

  it("counts, recent and attention per track; archived and other users' rows are left out; tracks keep their order", async () => {
    const j = track("Job", 0), p = track("PhD", 1);
    j.add("soon", j.toApply, { deadline: "2026-11-18", touchedDaysAgo: 2 });
    j.add("late", j.toApply, { deadline: "2026-11-10", touchedDaysAgo: 4 });
    j.add("far", j.toApply, { deadline: "2026-12-30", touchedDaysAgo: 6 });
    const stale = j.add("quiet", j.applied, { touchedDaysAgo: 30 });
    j.add("fresh", j.applied, { touchedDaysAgo: 3 });
    j.add("won", j.interview, { touchedDaysAgo: 40 });
    j.add("hidden", j.toApply, { deadline: "2026-11-18", archived: true });
    j.add("foreign", j.applied, { deadline: "2026-11-18", touchedDaysAgo: 0, userId: "other" });
    p.add("p1", p.toApply);
    db.insert(submissions).values({ userId: "local", applicationId: stale, date: "2026-11-03" }).run();

    const [job, phd] = await getTrackOverviews(TODAY, NOW);
    expect([job.name, phd.name]).toEqual(["Job", "PhD"]);
    expect([job.total, job.toApply, job.submitted, job.wins, job.winRate, job.submittedThisMonth]).toEqual([6, 3, 2, 1, 33, 1]);
    expect(job.recent.map((r) => r.title)).toEqual(["soon", "fresh", "late"]);
    expect(job.attention.map((a) => [a.title, a.kind, a.when])).toEqual([["late", "Deadline", "7 days late"], ["soon", "Deadline", "Tomorrow"], ["quiet", "No update since submitting", "30 days"]]);
    expect([phd.total, phd.toApply, phd.attention.length]).toEqual([1, 1, 0]);
  });

  it("a note counts as an update: it takes an application out of the stale list", async () => {
    const j = track("Job", 0);
    const a = j.add("quiet", j.applied, { touchedDaysAgo: 30 });
    expect((await getTrackOverviews(TODAY, NOW))[0].attention).toHaveLength(1);
    db.insert(notes).values({ userId: "local", applicationId: a, body: "called", createdAt: new Date(NOW - DAY) }).run();
    expect((await getTrackOverviews(TODAY, NOW))[0].attention).toEqual([]);
  });

  it("follows the still-to-do setting and keeps the empty track and the no-track case", async () => {
    expect(await getTrackOverviews(TODAY, NOW)).toEqual([]);
    const j = track("Job", 0);
    j.add("sent", j.applied, { deadline: "2026-11-20" });
    expect((await getTrackOverviews(TODAY, NOW))[0]).toMatchObject({ toApply: 0, attention: [] });
    await setStillToDo(j.t, [j.applied]);
    expect((await getTrackOverviews(TODAY, NOW))[0]).toMatchObject({ toApply: 1, attention: [{ title: "sent", when: "In 3 days" }] });
    const empty = track("Empty", 1);
    expect((await getTrackOverviews(TODAY, NOW))[1]).toMatchObject({ id: empty.t, total: 0, recent: [], attention: [], updatedMs: null });
  });

  it("sidebar counts: non-archived applications per track, 0 for an empty one, other users excluded", async () => {
    const j = track("Job", 0);
    track("PhD", 1);
    j.add("a", j.toApply); j.add("b", j.toApply); j.add("c", j.toApply, { archived: true }); j.add("d", j.toApply, { userId: "other" });
    expect((await listTrackCounts()).map((t) => [t.name, t.count])).toEqual([["Job", 2], ["PhD", 0]]);
  });
});
