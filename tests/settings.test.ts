import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settings } from "@/lib/db/schema";
import { getFilesRoot, getSetting, setFilesRoot, setSetting } from "@/lib/db/settings";
import { dropTestDb, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { db = useTestDb(); });
afterEach(dropTestDb);

describe("settings data layer", () => {
  it("returns undefined for an unset key and round-trips JSON values", async () => {
    expect(await getSetting("x")).toBeUndefined();
    await setSetting("x", { a: [1, "b", null] });
    expect(await getSetting("x")).toEqual({ a: [1, "b", null] });
  });

  it("upserts: one row per key, scoped to the user, value replaced", async () => {
    await setSetting("x", 1);
    await setSetting("x", 2);
    await setSetting("y", 3);
    const rows = db.select().from(settings).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === "local")).toBe(true);
    expect(await getSetting("x")).toBe(2);
  });

  it("treats corrupt JSON as unset and refuses unserialisable values", async () => {
    db.insert(settings).values({ userId: "local", key: "bad", value: "{nope" }).run();
    expect(await getSetting("bad")).toBeUndefined();
    await expect(setSetting("u", undefined)).rejects.toThrow();
  });

  it("files root: null until set, then the stored string", async () => {
    expect(await getFilesRoot()).toBeNull();
    await setFilesRoot("/some/where");
    expect(await getFilesRoot()).toBe("/some/where");
    await setSetting("files_root", 5);
    expect(await getFilesRoot()).toBeNull();
  });
});
