import { chmodSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFiles } from "@/app/actions/files";
import { GET } from "@/app/api/files/[id]/route";
import { createApplication } from "@/lib/db/applications";
import { listApplicationFiles } from "@/lib/db/files";
import { applications, files, settings, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import { createSubmission, listSubmissions } from "@/lib/db/submissions";
import { checkApplicationFiles } from "@/lib/files/check";
import { checkSummary, integrityLabel } from "@/lib/file-integrity";
import { storeUploadedFile } from "@/lib/files/store";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-form";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;

async function mkApp(title: string) {
  const r = await createApplication({ title, trackId: db.select().from(tracks).all()[0].id, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function store(name: string, content: string, app = appId) {
  const r = await storeUploadedFile({ applicationId: app, file: new File([content], name), label: "CV", uploadDate: "2026-11-08" });
  if (!r.ok || !("file" in r)) throw new Error("store failed");
  return r.file;
}
const edit = (rel: string, content: string) => {
  chmodSync(join(root, rel), 0o644);
  writeFileSync(join(root, rel), content);
};
const remove = (rel: string) => {
  chmodSync(join(root, rel), 0o666);
  rmSync(join(root, rel));
};
const state = async (id: number) => (await listApplicationFiles(appId)).find((f) => f.id === id)!;

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-integrity-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  appId = await mkApp("Acme");
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("wording", () => {
  it("labels only the flagged states", () => {
    expect(integrityLabel("ok")).toBeNull();
    expect(integrityLabel("mismatch")).toBe("Changed since upload");
    expect(integrityLabel("missing")).toBe("Missing");
  });
  it("summarises the counts", () => {
    expect(checkSummary({ ok: 3, mismatch: 0, missing: 0, failed: 0 })).toBe("All 3 files OK");
    expect(checkSummary({ ok: 1, mismatch: 0, missing: 0, failed: 0 })).toBe("All 1 file OK");
    expect(checkSummary({ ok: 1, mismatch: 1, missing: 1, failed: 0 })).toBe("1 file changed, 1 missing");
    expect(checkSummary({ ok: 0, mismatch: 2, missing: 0, failed: 1 })).toBe("2 files changed, 1 could not be read");
    expect(checkSummary({ ok: 0, mismatch: 0, missing: 0, failed: 0 })).toBe("No files to check");
  });
});

describe("state in the lists", () => {
  it("listApplicationFiles and listSubmissions return the recorded state and check time", async () => {
    const a = await store("a.pdf", "one");
    expect(await state(a.id)).toMatchObject({ integrity: "ok", checkedAt: null });
    await createSubmission(appId, [a.id], "2026-11-09", null);
    edit(a.relativePath, "changed");
    await checkApplicationFiles(appId);
    expect(await state(a.id)).toMatchObject({ integrity: "mismatch", checkedAt: expect.any(Date) });
    const [sub] = await listSubmissions(appId);
    expect(sub.files[0]).toMatchObject({ id: a.id, integrity: "mismatch", checkedAt: expect.any(Date) });
  });
});

describe("Check files", () => {
  it("records ok, mismatch and missing, returns the counts, and a restored file goes back to ok", async () => {
    const a = await store("a.pdf", "one");
    const b = await store("b.pdf", "two");
    const c = await store("c.pdf", "three");
    edit(b.relativePath, "TWO!");
    remove(c.relativePath);
    const r = await checkApplicationFiles(appId);
    expect(r).toMatchObject({ ok: true, counts: { ok: 1, mismatch: 1, missing: 1, failed: 0 }, summary: "1 file changed, 1 missing" });
    expect((await state(a.id)).integrity).toBe("ok");
    expect((await state(b.id)).integrity).toBe("mismatch");
    expect((await state(c.id)).integrity).toBe("missing");
    edit(b.relativePath, "two");
    writeFileSync(join(root, c.relativePath), "three");
    expect(await checkApplicationFiles(appId)).toMatchObject({ summary: "All 3 files OK" });
    expect((await state(b.id)).integrity).toBe("ok");
    expect((await state(c.id)).integrity).toBe("ok");
  });
  it("a file over the upload cap is a mismatch and does not crash; an unreadable one is counted as could-not-be-read", async () => {
    const a = await store("a.pdf", "one");
    const b = await store("b.pdf", "two");
    chmodSync(join(root, a.relativePath), 0o644);
    truncateSync(join(root, a.relativePath), MAX_UPLOAD_BYTES + 1); // sparse
    db.update(files).set({ relativePath: "../outside" }).where(eq(files.id, b.id)).run(); // refused by resolveInRoot
    expect(await checkApplicationFiles(appId)).toMatchObject({ ok: true, counts: { ok: 0, mismatch: 1, missing: 0, failed: 1 }, summary: "1 file changed, 1 could not be read" });
    expect((await state(a.id)).integrity).toBe("mismatch");
    expect((await state(b.id)).integrity).toBe("ok"); // not a verdict, state untouched
  });
  it("an application with no files, an unknown id and another user's application are refused or empty", async () => {
    expect(await checkApplicationFiles(appId)).toMatchObject({ ok: true, summary: "No files to check" });
    expect(await checkApplicationFiles(999)).toEqual({ ok: false, error: "Application not found." });
    const f = await store("a.pdf", "one");
    edit(f.relativePath, "changed");
    db.update(applications).set({ userId: "someone-else" }).run();
    expect(await checkApplicationFiles(appId)).toEqual({ ok: false, error: "Application not found." });
    expect(db.select().from(files).where(eq(files.id, f.id)).get()!.integrity).toBe("ok");
  });
  it("without a files folder it stops with the Settings message", async () => {
    await store("a.pdf", "one");
    db.delete(settings).run();
    const r = await checkApplicationFiles(appId);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Settings") });
  });
  it("the server action checks its argument and returns the result", async () => {
    const a = await store("a.pdf", "one");
    edit(a.relativePath, "changed");
    for (const bad of [0, -1, 1.5, "1", null, NaN]) expect(await checkFiles(bad as never)).toEqual({ ok: false, error: "Application not found." });
    expect(await checkFiles(appId)).toMatchObject({ ok: true, summary: "1 file changed" });
    expect((await state(a.id)).integrity).toBe("mismatch");
  });
});

describe("Open when the missing state cannot be recorded (8.6 review)", () => {
  it("answers with the JSON 404 instead of throwing", async () => {
    const f = await store("a.pdf", "one");
    remove(f.relativePath);
    db.run(sql`CREATE TRIGGER no_update BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT, 'database is locked'); END`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new NextRequest(`http://localhost:3000/api/files/${f.id}`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(f.id) }) } as never);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("is missing");
    spy.mockRestore();
  });
});
