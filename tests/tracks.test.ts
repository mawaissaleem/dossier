import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTrack, listTracks } from "@/lib/db/tracks";
import { columns, tracks } from "@/lib/db/schema";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
beforeEach(() => {
  db = useTestDb();
});
afterEach(dropTestDb);

describe("seed + listTracks", () => {
  it("lists Job then PhD after seeding, without other users' tracks", async () => {
    runSeed();
    db.insert(tracks).values({ userId: "someone-else", name: "Other", position: -1 }).run();
    expect((await listTracks()).map((t) => t.name)).toEqual(["Job", "PhD"]);
  });

  it("seed is idempotent", () => {
    runSeed();
    const counts = () => [db.select().from(tracks).all().length, db.select().from(columns).all().length];
    const first = counts();
    runSeed();
    expect(counts()).toEqual(first);
    expect(first[0]).toBe(2);
  });
});

describe("getTrack", () => {
  it("returns own track; null for missing or another user's", async () => {
    const own = db.insert(tracks).values({ userId: "local", name: "Job", position: 0 }).returning().get().id;
    const foreign = db.insert(tracks).values({ userId: "someone-else", name: "X", position: 1 }).returning().get().id;
    expect(await getTrack(own)).toMatchObject({ id: own, name: "Job" });
    expect(await getTrack(foreign)).toBeNull();
    expect(await getTrack(9999)).toBeNull();
  });
});
