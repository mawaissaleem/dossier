import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchApplications } from "@/lib/db/search";
import { applications, cellValues, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let job: number;
let phd: number;
let city: number;
let site: number;
let salary: number;
const app = (title: string, over: Partial<typeof applications.$inferInsert> = {}) =>
  db.insert(applications).values({ userId: "local", trackId: job, title, ...over }).returning().get().id;
const cell = (applicationId: number, columnId: number, valueText: string, userId = "local") =>
  db.insert(cellValues).values({ userId, applicationId, columnId, valueText }).run();
const titles = async (q: string, limit?: number) => (await searchApplications(q, { limit })).map((h) => h.title);

beforeEach(() => {
  db = useTestDb();
  job = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  phd = db.insert(tracks).values({ userId: "local", name: "PhD", position: 1 }).returning().get().id;
  const col = (name: string, type: "text" | "link" | "number", position: number, trackId = job) =>
    db.insert(columns).values({ userId: "local", trackId, name, type, position }).returning().get().id;
  city = col("City", "text", 0);
  site = col("Site", "link", 1);
  salary = col("Salary", "number", 2);
});
afterEach(dropTestDb);

describe("searchApplications", () => {
  it("finds by title and by text and link cells, across tracks, with track and matched field", async () => {
    const a = app("Acme Robotics");
    const b = app("Other", { trackId: phd });
    const phdCity = db.insert(columns).values({ userId: "local", trackId: phd, name: "Lab", type: "text", position: 0 }).returning().get().id;
    cell(b, phdCity, "Northvale robotics lab");
    cell(a, site, "https://careers.acme.example/jobs/42");
    const hits = await searchApplications("robotics");
    expect(hits.map((h) => h.id)).toEqual([a, b]); // title match first
    expect(hits[0]).toMatchObject({ title: "Acme Robotics", archived: false, track: { id: job, name: "Job" }, matched: { kind: "title", column: null } });
    expect(hits[1]).toMatchObject({ track: { id: phd, name: "PhD" }, matched: { kind: "cell", column: "Lab", snippet: "Northvale robotics lab" } });
    expect((await searchApplications("careers.acme"))[0].matched).toMatchObject({ column: "Site" });
    expect(Object.keys(hits[0]).sort()).toEqual(["archived", "id", "matched", "title", "track"]); // no internal tier leaks
  });

  it("ignores number cells, and a deleted column's values", async () => {
    const a = app("Acme");
    db.insert(cellValues).values({ userId: "local", applicationId: a, columnId: salary, valueNumber: 90210 }).run();
    cell(a, city, "Gone-town");
    expect(await titles("90210")).toEqual([]);
    expect(await titles("gone-town")).toEqual(["Acme"]);
    db.delete(columns).where(eq(columns.id, city)).run();
    expect(await titles("gone-town")).toEqual([]);
  });

  it("is case-insensitive and accent-insensitive, including non-ASCII", async () => {
    app("Uni Zürich");
    const b = app("Other");
    cell(b, city, "École Polytechnique");
    expect(await titles("ZÜRICH")).toEqual(["Uni Zürich"]);
    expect(await titles("zurich")).toEqual(["Uni Zürich"]);
    expect(await titles("zürich")).toEqual(["Uni Zürich"]);
    expect(await titles("ecole")).toEqual(["Other"]);
    expect(await titles("éCOLE")).toEqual(["Other"]);
  });

  it("needs every word, in any mix of title and cells", async () => {
    const a = app("Acme Robotics");
    cell(a, city, "Berlin");
    app("Acme Foods");
    expect(await titles("acme berlin")).toEqual(["Acme Robotics"]);
    expect(await titles("berlin   robotics")).toEqual(["Acme Robotics"]);
    expect(await titles("acme paris")).toEqual([]);
  });

  it("treats % _ and \\ as plain characters", async () => {
    app("Acme");
    app("100% remote");
    app("a_b");
    app("path\\x");
    expect(await titles("%")).toEqual(["100% remote"]);
    expect(await titles("_")).toEqual(["a_b"]);
    expect(await titles("\\")).toEqual(["path\\x"]);
    expect(await titles("a%")).toEqual([]);
    expect(await titles("a_b")).toEqual(["a_b"]);
  });

  it("never returns another user's data", async () => {
    const other = db.insert(tracks).values({ userId: "someone", name: "Theirs", position: 0 }).returning().get().id;
    const oc = db.insert(columns).values({ userId: "someone", trackId: other, name: "City", type: "text", position: 0 }).returning().get().id;
    const theirs = app("Acme secret", { userId: "someone", trackId: other });
    cell(theirs, oc, "acme", "someone");
    const mine = app("Acme");
    cell(mine, city, "secret", "someone"); // a foreign cell attached to my application
    app("Acme in foreign track", { trackId: other });
    expect(await titles("acme")).toEqual(["Acme"]);
    expect(await titles("secret")).toEqual([]);
  });

  it("includes archived applications, flagged", async () => {
    app("Acme old", { archived: true });
    const [hit] = await searchApplications("acme");
    expect(hit).toMatchObject({ title: "Acme old", archived: true });
  });

  it("ranks exact > prefix > word start > contains > cell, then newest", async () => {
    const cellOnly = app("Zed");
    cell(cellOnly, city, "acme");
    app("Beacme Co");
    app("The Acme Co");
    app("Acme Co");
    app("Acme");
    app("Acme Labs");
    expect(await titles("acme")).toEqual(["Acme", "Acme Labs", "Acme Co", "The Acme Co", "Beacme Co", "Zed"]);
  });

  it("limits to 20 by default and 50 at most", async () => {
    for (let i = 0; i < 60; i++) app(`Acme ${i}`);
    expect(await titles("acme")).toHaveLength(20);
    expect(await titles("acme", 5)).toHaveLength(5);
    expect(await titles("acme", 500)).toHaveLength(50);
    expect((await titles("acme"))[0]).toBe("Acme 59"); // same tier: newest first
  });

  it("returns nothing for a blank or oversized query", async () => {
    app("Acme");
    expect(await searchApplications("")).toEqual([]);
    expect(await searchApplications("   ")).toEqual([]);
    expect(await searchApplications("a".repeat(201))).toEqual([]);
  });

  it("runs a fixed 2 queries and stays fast at 2000 applications", async () => {
    const ids = db.insert(applications).values(Array.from({ length: 2000 }, (_, i) => ({ userId: "local", trackId: job, title: `Company ${i}` }))).returning({ id: applications.id }).all();
    for (let at = 0; at < ids.length; at += 200)
      db.insert(cellValues).values(ids.slice(at, at + 200).map(({ id }) => ({ userId: "local", applicationId: id, columnId: city, valueText: `City of ${id} Zürich` }))).run();
    const prepare = vi.spyOn(db.$client, "prepare");
    const started = performance.now();
    const hits = await searchApplications("zurich company 1999");
    const ms = performance.now() - started;
    expect(hits.map((h) => h.title)).toEqual(["Company 1999", "Company 1998"]); // the title hit, then the app whose city cell says 1999
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(ms).toBeLessThan(500); // about 20 ms on the dev machine; NFR-1 allows 500
  });
});
