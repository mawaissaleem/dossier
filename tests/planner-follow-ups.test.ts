import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFollowUpsDue, getPlannerRanking, plannerSlotsKey } from "@/lib/db/planner";
import { setSetting } from "@/lib/db/settings";
import { applications, cellValues, columnOptions, columns, submissions, tracks } from "@/lib/db/schema";
import { followUpsDue, type FollowUpInput } from "@/lib/planner";
import { dropTestDb, useTestDb } from "./helpers/db";

const TODAY = "2026-11-12";
const item = (id: number, followUp: unknown, o: Partial<FollowUpInput> = {}): FollowUpInput => ({ id, followUp, hasSubmission: true, submittedStatus: false, ...o });
const ids = (xs: FollowUpInput[]) => followUpsDue(xs, TODAY).map((x) => x.id);

describe("followUpsDue (pure)", () => {
  it("future excluded, today and past included", () => {
    expect(ids([item(1, "2026-11-13"), item(2, TODAY), item(3, "2026-11-11")])).toEqual([3, 2]);
  });
  it("blank, invalid and non-string dates are excluded", () => {
    expect(ids([item(1, ""), item(2, null), item(3, "2026-02-30"), item(4, "11/10/2026"), item(5, 20261110)])).toEqual([]);
  });
  it("not submitted is excluded; a submission alone or a submitted status alone is enough", () => {
    const old = "2026-11-01";
    expect(ids([item(1, old, { hasSubmission: false }), item(2, old, { hasSubmission: true }), item(3, old, { hasSubmission: false, submittedStatus: true })])).toEqual([2, 3]);
  });
  it("oldest follow-up first, then id", () => {
    expect(ids([item(5, "2026-11-10"), item(2, "2026-11-10"), item(9, "2026-11-01"), item(1, TODAY)])).toEqual([9, 2, 5, 1]);
  });
  it("text: due today, 1 day ago, N days ago", () => {
    const r = followUpsDue([item(1, TODAY), item(2, "2026-11-11"), item(3, "2026-11-09")], TODAY);
    expect(r.map((x) => [x.id, x.text, x.daysAgo])).toEqual([[3, "3 days ago", 3], [2, "1 day ago", 1], [1, "due today", 0]]);
  });
  it("keeps the extra fields of an item", () => {
    expect(followUpsDue([{ ...item(1, TODAY), title: "x" }], TODAY)[0].title).toBe("x");
  });
});

describe("getFollowUpsDue (temp DB)", () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { db = useTestDb(); });
  afterEach(dropTestDb);

  function track(name: string, withFollowUp = true) {
    const t = db.insert(tracks).values({ userId: "local", name, position: 0 }).returning().get().id;
    const col = (n: string, type: "single_select" | "date", position: number, isStatus = false) => db.insert(columns).values({ userId: "local", trackId: t, name: n, type, position, isStatus }).returning().get().id;
    const status = col("Status", "single_select", 0, true);
    const dl = col("Deadline", "date", 1);
    const fu = withFollowUp ? col("Follow-up date", "date", 2) : null;
    const opt = (label: string, position: number) => db.insert(columnOptions).values({ userId: "local", columnId: status, label, color: "blue", position }).returning().get().id;
    const [todo, applied] = [opt("To apply", 0), opt("Applied", 1)];
    const add = (title: string, o: { status?: number; followUp?: string; deadline?: string; submission?: boolean; archived?: boolean }) => {
      const a = db.insert(applications).values({ userId: "local", trackId: t, title, archived: o.archived ?? false }).returning().get().id;
      const cells = [
        ...(o.status ? [{ userId: "local", applicationId: a, columnId: status, valueOptionId: o.status }] : []),
        ...(o.followUp && fu ? [{ userId: "local", applicationId: a, columnId: fu, valueDate: o.followUp }] : []),
        ...(o.deadline ? [{ userId: "local", applicationId: a, columnId: dl, valueDate: o.deadline }] : []),
      ];
      if (cells.length) db.insert(cellValues).values(cells).run();
      if (o.submission) db.insert(submissions).values({ userId: "local", applicationId: a, date: "2026-10-01" }).run();
      return a;
    };
    return { t, todo, applied, add };
  }

  it("lists submitted ones whose date arrived, across tracks, oldest first, with track and text", async () => {
    const job = track("Job");
    const a = job.add("by-status", { status: job.applied, followUp: "2026-11-10" });
    const b = job.add("by-submission", { status: job.todo, followUp: "2026-11-12", submission: true }); // submission row, status not submitted
    job.add("future", { status: job.applied, followUp: "2026-11-13" });
    job.add("not-submitted", { status: job.todo, followUp: "2026-11-01" });
    job.add("archived", { status: job.applied, followUp: "2026-11-01", archived: true });
    job.add("no-date", { status: job.applied });
    const phd = track("PhD");
    const c = phd.add("phd-old", { status: phd.applied, followUp: "2026-11-02" });
    const r = await getFollowUpsDue(TODAY);
    expect(r.map((x) => x.id)).toEqual([c, a, b]);
    expect(r[0]).toMatchObject({ title: "phd-old", trackName: "PhD", followUp: "2026-11-02", daysAgo: 10, text: "10 days ago" });
    expect(r[2].text).toBe("due today");
  });

  it("a track with no Follow-up slot contributes nothing; a saved slot of null does too", async () => {
    const none = track("NoSlot", false);
    none.add("x", { status: none.applied });
    const off = track("Off");
    off.add("y", { status: off.applied, followUp: "2026-11-01" });
    await setSetting(plannerSlotsKey(off.t), { priority: null, deadline: null, effort: null, followUp: null });
    expect(await getFollowUpsDue(TODAY)).toEqual([]);
  });

  it("the submission counts even after its file was deleted (tombstone): only the submission row matters", async () => {
    const job = track("Job");
    const a = job.add("sent", { status: job.todo, followUp: "2026-11-01", submission: true });
    expect((await getFollowUpsDue(TODAY)).map((x) => x.id)).toEqual([a]);
  });

  it("follow-up dates never change the ranking (FR-8.10)", async () => {
    const job = track("Job");
    job.add("a", { status: job.todo, deadline: "2026-11-20" });
    job.add("b", { status: job.todo, deadline: "2026-11-15", submission: true });
    job.add("c", { status: job.applied, deadline: "2026-11-13" });
    const before = await getPlannerRanking(TODAY);
    const fu = db.select().from(columns).all().find((c) => c.name === "Follow-up date")!.id;
    for (const a of db.select().from(applications).all()) db.insert(cellValues).values({ userId: "local", applicationId: a.id, columnId: fu, valueDate: "2026-01-01" }).run();
    const after = await getPlannerRanking(TODAY);
    expect(after).toEqual(before);
    expect(before.ranked.length).toBe(2);
  });
});
