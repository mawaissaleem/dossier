import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/files/[id]/route";
import { addSubmission } from "@/app/actions/submissions";
import { createApplication } from "@/lib/db/applications";
import { files, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import { listSubmissions } from "@/lib/db/submissions";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-at10-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  const trackId = db.select().from(tracks).all().find((t) => t.name === "Job")!.id;
  const r = await createApplication({ title: "Acme Robotics", trackId, values: [] });
  if (!r.ok) throw new Error(r.error);
  appId = r.id;
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

async function upload(content: string, uploadDate: string) {
  const r = await storeUploadedFile({ applicationId: appId, file: new File([content], "CV.pdf"), label: "CV", uploadDate });
  if (!r.ok || !("file" in r)) throw new Error(JSON.stringify(r));
  return r.file;
}

it("AT-10: after submitting CV v1, an uploaded corrected CV is file 02; the first submission still lists v1, a new one lists v2", async () => {
  const v1 = await upload("cv version 1", "2026-11-08");
  expect(await addSubmission(appId, [v1.id], "2026-11-08", "sent", null)).toEqual({ ok: true });

  const v2 = await upload("cv version 2, corrected", "2026-11-08");
  expect(v1.storedName).toBe("01-20261108-CV.pdf");
  expect(v2.storedName).toBe("02-20261108-CV.pdf");
  expect(v2.id).not.toBe(v1.id);
  expect(await addSubmission(appId, [v2.id], "2026-11-10", "corrected CV", null)).toEqual({ ok: true });

  expect(db.select().from(files).all().map((f) => [f.id, f.storedName])).toEqual([[v1.id, v1.storedName], [v2.id, v2.storedName]]);
  expect(readFileSync(join(root, v1.relativePath), "utf8")).toBe("cv version 1"); // the original is untouched on disk
  expect(readFileSync(join(root, v2.relativePath), "utf8")).toBe("cv version 2, corrected");

  const [newer, older] = await listSubmissions(appId);
  expect(older).toMatchObject({ date: "2026-11-08", note: "sent" });
  expect(older.files.map((f) => [f.id, f.storedName])).toEqual([[v1.id, "01-20261108-CV.pdf"]]);
  expect(newer).toMatchObject({ date: "2026-11-10", note: "corrected CV" });
  expect(newer.files.map((f) => [f.id, f.storedName])).toEqual([[v2.id, "02-20261108-CV.pdf"]]);
});

// The same through the Open route the timeline links to: each submission's file id serves that version's bytes.
it("AT-10 via the Open route: the first submission's file still serves version 1, the new one version 2", async () => {
  const v1 = await upload("cv version 1", "2026-11-08");
  await addSubmission(appId, [v1.id], "2026-11-08", null, null);
  const v2 = await upload("cv version 2, corrected", "2026-11-08");
  await addSubmission(appId, [v2.id], "2026-11-10", null, null);
  const [newer, older] = await listSubmissions(appId);
  const get = (id: number) => GET(new NextRequest(`http://localhost:3000/api/files/${id}`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(id) }) } as never);
  const [r1, r2] = [await get(older.files[0].id), await get(newer.files[0].id)];
  expect([r1.status, await r1.text()]).toEqual([200, "cv version 1"]);
  expect([r2.status, await r2.text()]).toEqual([200, "cv version 2, corrected"]);
  expect(older.files[0].storedName).toBe("01-20261108-CV.pdf");
  expect(newer.files[0].storedName).toBe("02-20261108-CV.pdf");
});
