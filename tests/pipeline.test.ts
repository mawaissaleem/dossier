import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPipelineCounts } from "@/lib/db/pipeline";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { pipelineCounts, pipelineSummary } from "@/lib/pipeline";
import { dropTestDb, useTestDb } from "./helpers/db";

const opts = [{ id: 1, label: "To apply", color: "gray" }, { id: 2, label: "Applied", color: "blue" }, { id: 3, label: "Offer", color: "green" }];
const job = { id: 10, name: "Job", statusColumnId: 100, options: opts };

describe("pipelineCounts (pure)", () => {
  it("empty track: every option at zero, in order, no No status", () => {
    const [t] = pipelineCounts([], [job]);
    expect(t.total).toBe(0);
    expect(t.segments.map((s) => [s.label, s.count])).toEqual([["To apply", 0], ["Applied", 0], ["Offer", 0]]);
  });
  it("keeps zero-count options between others, in the configured order", () => {
    const [t] = pipelineCounts([{ trackId: 10, optionId: 3, n: 2 }, { trackId: 10, optionId: 1, n: 5 }], [job]);
    expect(t.segments.map((s) => s.count)).toEqual([5, 0, 2]);
    expect(t.total).toBe(7);
  });
  it("No status last, only when above zero; a value that is not an option counts as No status", () => {
    const [t] = pipelineCounts([{ trackId: 10, optionId: null, n: 1 }, { trackId: 10, optionId: 99, n: 2 }, { trackId: 10, optionId: 2, n: 1 }], [job]);
    expect(t.segments.at(-1)).toEqual({ token: "blank", label: "No status", color: null, count: 3 });
    expect(t.total).toBe(4);
  });
  it("several tracks are counted apart and keep their order; a track without a status column gets only a total", () => {
    const phd = { id: 11, name: "PhD", statusColumnId: null, options: [] };
    const r = pipelineCounts([{ trackId: 11, optionId: null, n: 4 }, { trackId: 10, optionId: 2, n: 1 }], [phd, job]);
    expect(r.map((t) => t.name)).toEqual(["PhD", "Job"]);
    expect(r[0]).toMatchObject({ segments: [], total: 4 });
    expect(r[1].total).toBe(1);
  });
  it("summary lists non-zero segments", () => {
    const [t] = pipelineCounts([{ trackId: 10, optionId: 2, n: 3 }, { trackId: 10, optionId: 3, n: 1 }], [job]);
    expect(pipelineSummary(t)).toBe("Applied 3, Offer 1");
    expect(pipelineSummary(pipelineCounts([], [job])[0])).toBe("No applications");
  });
});

describe("getPipelineCounts (data layer)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  function track(name: string, position: number, userId = "local") {
    const t = db.insert(tracks).values({ userId, name, position }).returning().get().id;
    const status = db.insert(columns).values({ userId, trackId: t, name: "Status", type: "single_select", position: 0, isStatus: true }).returning().get().id;
    const opt = (label: string, p: number) => db.insert(columnOptions).values({ userId, columnId: status, label, color: "blue", position: p }).returning().get().id;
    const [a, b] = [opt("To apply", 0), opt("Applied", 1)];
    const add = (s: number | null, archived = false, uid = userId) => {
      const id = db.insert(applications).values({ userId: uid, trackId: t, title: "x", archived }).returning().get().id;
      if (s !== null) db.insert(cellValues).values({ userId: uid, applicationId: id, columnId: status, valueOptionId: s }).run();
      return id;
    };
    return { t, status, a, b, add };
  }

  it("counts per option, no status, in track order; archived rows are left out", async () => {
    const j = track("Job", 0);
    track("PhD", 1);
    j.add(j.a); j.add(j.a); j.add(j.b); j.add(null); j.add(j.a, true);
    const [job, phd] = await getPipelineCounts();
    expect(job).toMatchObject({ name: "Job", statusColumnId: j.status, total: 4 });
    expect(job.segments.map((s) => [s.label, s.count])).toEqual([["To apply", 2], ["Applied", 1], ["No status", 1]]);
    expect(phd).toMatchObject({ name: "PhD", total: 0 });
  });

  it("another user's rows and tracks are never counted", async () => {
    const j = track("Job", 0);
    j.add(j.a);
    j.add(j.a, false, "other");
    track("Theirs", 1, "other");
    const r = await getPipelineCounts();
    expect(r.map((t) => t.name)).toEqual(["Job"]);
    expect(r[0].total).toBe(1);
  });

  it("a track with no status column shows its total and no segments", async () => {
    const t = db.insert(tracks).values({ userId: "local", name: "Loose", position: 0 }).returning().get().id;
    db.insert(applications).values({ userId: "local", trackId: t, title: "x" }).run();
    expect((await getPipelineCounts())[0]).toMatchObject({ statusColumnId: null, segments: [], total: 1 });
  });

  it("a renamed option shows its new label", async () => {
    const j = track("Job", 0);
    j.add(j.b);
    db.update(columnOptions).set({ label: "Sent" }).where(eq(columnOptions.id, j.b)).run();
    expect((await getPipelineCounts())[0].segments.map((s) => s.label)).toEqual(["To apply", "Sent"]);
  });
});
