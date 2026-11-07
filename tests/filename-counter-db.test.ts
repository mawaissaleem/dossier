import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "@/lib/db/applications";
import { getCounterEntries } from "@/lib/db/files";
import { files, tracks } from "@/lib/db/schema";
import { buildStoredName } from "@/lib/filename";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
beforeEach(() => {
  db = useTestDb();
  runSeed();
});
afterEach(() => dropTestDb());

async function mkApp() {
  const r = await createApplication({ title: "T", trackId: db.select().from(tracks).get()!.id, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
// What 5.7 will do: load the entries, build the name, insert the row.
async function upload(applicationId: number, name: string, date = "2026-11-08") {
  const r = buildStoredName(name, date, await getCounterEntries(applicationId));
  db.insert(files).values({ userId: "local", applicationId, label: "CV", originalName: name, storedName: r.storedName, relativePath: `${applicationId}/${r.storedName}`, sha256: "a".repeat(64), sizeBytes: 1, uploadDate: date, baseName: r.baseName, extension: r.extension, seq: r.seq }).run();
  return r.storedName;
}

describe("getCounterEntries + buildStoredName", () => {
  it("returns only that application's entries", async () => {
    const a = await mkApp();
    const b = await mkApp();
    await upload(a, "CV.pdf");
    await upload(b, "CV.pdf");
    expect(await getCounterEntries(a)).toEqual([{ baseName: "CV", uploadDate: "2026-11-08", extension: "pdf", seq: 1 }]);
  });
  it("AT-5 against stored rows, with counters per application and per day", async () => {
    const a = await mkApp();
    const b = await mkApp();
    expect(await upload(a, "CV.docx")).toBe("01-20261108-CV.docx");
    expect(await upload(a, "CV.pdf")).toBe("01-20261108-CV.pdf");
    expect(await upload(a, "CV.pdf")).toBe("02-20261108-CV.pdf");
    expect(await upload(a, "cv.PDF")).toBe("03-20261108-cv.pdf");
    expect(await upload(b, "CV.pdf")).toBe("01-20261108-CV.pdf");
    expect(await upload(a, "CV.pdf", "2026-11-09")).toBe("01-20261109-CV.pdf");
  });
  it("names that split differently but render the same tail share a counter, so no path clash", async () => {
    const a = await mkApp();
    expect(await upload(a, "CV.pdf")).toBe("01-20261108-CV.pdf");
    expect(await upload(a, "CV.pdf.")).toBe("02-20261108-CV.pdf");
    expect(await upload(a, "CV.pdf.é")).toBe("03-20261108-CV.pdf");
    expect(await upload(a, "a.b")).toBe("01-20261108-a.b");
    expect(await upload(a, "a.b..")).toBe("02-20261108-a.b");
  });
});
