import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/tracks/[id]/export/route";
import { applications, cellValues, columnOptions, columns, tracks } from "@/lib/db/schema";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let trackId: number;
const get = (id: string | number, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/api/tracks/${id}/export`, { headers: { host: "localhost:3000", ...headers } }), {
    params: Promise.resolve({ id: String(id) }),
  });
const text = async (res: Response) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());

beforeEach(() => {
  db = useTestDb();
  trackId = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
  const status = db.insert(columns).values({ userId: "local", trackId, name: "Status", type: "single_select", position: 1, isStatus: true }).returning().get().id;
  const secret = db.insert(columns).values({ userId: "local", trackId, name: "Notes", type: "text", position: 2, hidden: true }).returning().get().id;
  const date = db.insert(columns).values({ userId: "local", trackId, name: "Deadline", type: "date", position: 0 }).returning().get().id;
  const applied = db.insert(columnOptions).values({ userId: "local", columnId: status, label: "Applied", color: "red", position: 0 }).returning().get().id;
  const a = db.insert(applications).values({ userId: "local", trackId, title: "Acme, Zürich" }).returning().get().id;
  const b = db.insert(applications).values({ userId: "local", trackId, title: "Old one", archived: true }).returning().get().id;
  db.insert(cellValues).values([
    { userId: "local", applicationId: a, columnId: status, valueOptionId: applied },
    { userId: "local", applicationId: a, columnId: secret, valueText: "=1+1" },
    { userId: "local", applicationId: a, columnId: date, valueDate: "2026-11-11" },
    { userId: "local", applicationId: b, columnId: secret, valueText: "hidden col" },
  ]).run();
});
afterEach(dropTestDb);

describe("GET /api/tracks/:id/export", () => {
  it("sends a CSV attachment with labels, hidden columns and archived rows, newest first", async () => {
    const res = await get(trackId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="dossier-job-\d{8}\.csv"/);
    expect(await text(res)).toBe(
      "﻿Title,Deadline,Status,Notes,Archived\r\n" + 'Old one,,,hidden col,Yes\r\n' + '"Acme, Zürich",2026-11-11,Applied,\'=1+1,No\r\n',
    );
  });
  it("is 404 for a missing track, a junk id and another user's track", async () => {
    const other = db.insert(tracks).values({ userId: "someone-else", name: "Theirs", position: 0 }).returning().get().id;
    for (const id of [trackId + 100, "abc", other]) {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("refuses a non-local Host and cross-site fetches, allows same-origin and none", async () => {
    expect((await get(trackId, { host: "evil.example" })).status).toBe(403);
    expect((await get(trackId, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get(trackId, { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await get(trackId, { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await get(trackId, { "sec-fetch-site": "none" })).status).toBe(200);
  });
});
