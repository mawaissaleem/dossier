import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listApplicationRows } from "@/lib/db/applications";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

// Regression guard for NFR-1 (task 4.5): the track page must not get an N+1 or a slow read as the table grows.
let db: ReturnType<typeof useTestDb>;
beforeEach(() => { db = useTestDb(); });
afterEach(dropTestDb);

const N = 2000;
const chunks = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

describe("listApplicationRows at 2000 rows", () => {
  it("runs a fixed 4 queries and stays well inside a generous time bound", async () => {
    const trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const col = (type: "text" | "number" | "single_select" | "checkbox", position: number) =>
      db.insert(columns).values({ userId: "local", trackId, name: `${type}`, type, position }).returning().get().id;
    const [text, num, sel, box] = [col("text", 0), col("number", 1), col("single_select", 2), col("checkbox", 3)];
    const opts = ["A", "B", "C"].map((label, position) => db.insert(columnOptions).values({ userId: "local", columnId: sel, label, color: "red", position }).returning().get().id);
    const ids = chunks(Array.from({ length: N }, (_, i) => ({ userId: "local", trackId, title: `App ${i}` }))).flatMap((c) => db.insert(applications).values(c).returning({ id: applications.id }).all().map((r) => r.id));
    const cells = ids.flatMap((applicationId, i) => [
      { userId: "local", applicationId, columnId: text, valueText: `Company ${i}` },
      { userId: "local", applicationId, columnId: num, valueNumber: i },
      { userId: "local", applicationId, columnId: sel, valueOptionId: opts[i % 3] },
      { userId: "local", applicationId, columnId: box, valueBool: i % 2 === 0 },
    ]);
    for (const c of chunks(cells, 200)) db.insert(cellValues).values(c).run();

    const prepare = vi.spyOn(db.$client, "prepare");
    const started = performance.now();
    const rows = await listApplicationRows(trackId);
    const ms = performance.now() - started;

    expect(rows).toHaveLength(N);
    expect(rows[0].values).toMatchObject({ [text]: `Company ${N - 1}`, [box]: false }); // newest first
    expect(prepare).toHaveBeenCalledTimes(4); // columns, options, applications, cell values: no per-row query
    expect(ms).toBeLessThan(2000); // about 50 ms on the dev machine; the bound only catches an accidental O(n^2) or N+1
  });
});
