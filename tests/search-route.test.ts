import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/search/route";
import { applications, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
const get = (qs: string, host = "localhost:3000") => GET(new NextRequest(`http://localhost:3000/api/search${qs}`, { headers: { host } }));

beforeEach(() => {
  db = useTestDb();
  const trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  db.insert(applications).values({ userId: "local", trackId, title: "Acme Robotics" }).run();
});
afterEach(dropTestDb);

describe("GET /api/search", () => {
  it("returns JSON hits, never cached", async () => {
    const res = await get("?q=%20acme%20");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { results } = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Acme Robotics", track: { name: "Job" } });
  });
  it("answers a blank or missing q with an empty list, an over-long q with 400", async () => {
    for (const qs of ["", "?q=", "?q=%20%20"]) {
      const res = await get(qs);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }
    const res = await get(`?q=${"a".repeat(201)}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/200/);
  });
  it("honours limit and ignores a junk limit", async () => {
    expect((await (await get("?q=acme&limit=0")).json()).results).toHaveLength(1);
    expect((await (await get("?q=acme&limit=abc")).json()).results).toHaveLength(1);
  });
  it("refuses a non-local Host (DNS rebinding)", async () => {
    expect((await get("?q=acme", "evil.example")).status).toBe(403);
    expect((await get("?q=acme", "127.0.0.1:3000")).status).toBe(200);
    expect((await get("?q=acme", "[::1]:3000")).status).toBe(200);
  });
});
