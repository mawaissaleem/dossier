import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveOptionBuffer } from "@/app/actions/settings";
import { getPlannerRanking } from "@/lib/db/planner";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

// 10.7: the settings screen's preview is just getPlannerRanking read after a save, so nothing may be cached between calls.
describe("a settings save changes the ranking on the very next read (AT-11, FR-8.11)", () => {
  const TODAY = "2026-11-12";
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
  afterEach(dropTestDb);

  function setup() {
    const t = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const col = (name: string, type: "single_select" | "date", position: number, isStatus = false) => db.insert(columns).values({ userId: "local", trackId: t, name, type, position, isStatus }).returning().get().id;
    const [status, pr, dl] = [col("Status", "single_select", 0, true), col("Priority", "single_select", 1), col("Deadline", "date", 2)];
    const opt = (columnId: number, label: string, position: number, bufferDays: number) => db.insert(columnOptions).values({ userId: "local", columnId, label, color: "blue", position, bufferDays }).returning().get().id;
    const todo = opt(status, "To apply", 0, 0);
    const [priority, good] = [opt(pr, "Priority", 0, 3), opt(pr, "Good-to-have", 1, 0)];
    const add = (title: string, deadline: string, p: number) => {
      const a = db.insert(applications).values({ userId: "local", trackId: t, title }).returning().get().id;
      db.insert(cellValues).values([
        { userId: "local", applicationId: a, columnId: status, valueOptionId: todo },
        { userId: "local", applicationId: a, columnId: pr, valueOptionId: p },
        { userId: "local", applicationId: a, columnId: dl, valueDate: deadline },
      ]).run();
    };
    add("prio-in-2", "2026-11-14", priority);
    add("good-in-1", "2026-11-13", good);
    return { priority };
  }
  const titles = async () => (await getPlannerRanking(TODAY)).ranked.map((r) => r.title);

  it("buffer 3 -> 0 -> 3 flips the order and back, each save refreshing the page", async () => {
    const { priority } = setup();
    expect(await titles()).toEqual(["prio-in-2", "good-in-1"]); // 2 - 3 = -1 < 1 - 0
    expect(await saveOptionBuffer(priority, 0)).toEqual({ ok: true }); // 2 - 0 = 2 > 1
    expect(await titles()).toEqual(["good-in-1", "prio-in-2"]);
    expect(await saveOptionBuffer(priority, 3)).toEqual({ ok: true });
    expect(await titles()).toEqual(["prio-in-2", "good-in-1"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
