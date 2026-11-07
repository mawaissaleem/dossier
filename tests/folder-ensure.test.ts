import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "@/lib/db/applications";
import { columns, files, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import { ensureApplicationFolder } from "@/lib/files/folder";
import { eq, sql } from "drizzle-orm";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let base: string, root: string;

async function mkApp(trackName: string, vals: Record<string, string>, title = "T") {
  const trackId = db.select().from(tracks).where(eq(tracks.name, trackName)).get()!.id;
  const cols = db.select().from(columns).where(eq(columns.trackId, trackId)).all();
  const values = Object.entries(vals).map(([n, value]) => ({ columnId: cols.find((c) => c.name === n)!.id, value }));
  const r = await createApplication({ title, trackId, values });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
let n = 0;
const addFile = (applicationId: number, relativePath: string) =>
  db.insert(files).values({ userId: "local", applicationId, label: "CV", originalName: "cv.pdf", storedName: "cv.pdf", relativePath, sha256: "a".repeat(64), sizeBytes: 1, uploadDate: "2026-10-15", baseName: "CV", extension: "pdf", seq: ++n }).run();

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-folder-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("ensureApplicationFolder", () => {
  it("creates Company_Role_YYYY-MM under the root on the first upload", async () => {
    const id = await mkApp("Job", { Company: "Acme Corp", Role: "Data Engineer" });
    const r = await ensureApplicationFolder(id, "2026-10-15");
    expect(r).toEqual({ ok: true, relativePath: "Acme_Corp_Data_Engineer_2026-10", absolutePath: join(root, "Acme_Corp_Data_Engineer_2026-10") });
    expect(readdirSync(root)).toEqual(["Acme_Corp_Data_Engineer_2026-10"]);
  });

  it("PhD uses University and Program; a blank value uses the title", async () => {
    const a = await mkApp("PhD", { University: "ETH Zürich", Program: "CS" });
    expect((await ensureApplicationFolder(a, "2026-11-01") as { relativePath: string }).relativePath).toBe("ETH_Zürich_CS_2026-11");
    const b = await mkApp("Job", { Company: "Acme" }, "Cold email");
    expect((await ensureApplicationFolder(b, "2026-11-01") as { relativePath: string }).relativePath).toBe("Cold_email_2026-11");
  });

  it("is stable: once files exist, the folder is theirs even after the company is renamed", async () => {
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    const first = await ensureApplicationFolder(id, "2026-10-15");
    if (!first.ok) throw new Error(first.error);
    addFile(id, `${first.relativePath}/CV_1.pdf`);
    const colId = db.select().from(columns).where(eq(columns.name, "Company")).get()!.id;
    db.run(sql`update cell_values set value_text = 'Renamed Inc' where column_id = ${colId}`);
    const again = await ensureApplicationFolder(id, "2027-03-03");
    expect(again).toEqual(first);
    expect(readdirSync(root)).toEqual([first.relativePath]);
  });

  it("recreates the folder if it was removed from disk", async () => {
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    const first = await ensureApplicationFolder(id, "2026-10-15");
    if (!first.ok) throw new Error(first.error);
    addFile(id, `${first.relativePath}/CV_1.pdf`);
    rmSync(first.absolutePath, { recursive: true });
    expect(await ensureApplicationFolder(id, "2026-10-15")).toEqual(first);
    expect(existsSync(first.absolutePath)).toBe(true);
  });

  it("refuses when a regular file now sits where the folder was", async () => {
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    const first = await ensureApplicationFolder(id, "2026-10-15");
    if (!first.ok) throw new Error(first.error);
    addFile(id, `${first.relativePath}/CV_1.pdf`);
    rmSync(first.absolutePath, { recursive: true });
    writeFileSync(first.absolutePath, "x");
    expect(await ensureApplicationFolder(id, "2026-10-15")).toMatchObject({ ok: false });
  });

  it("is unique against other applications' folders (DB), case-insensitively", async () => {
    const a = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    const b = await mkApp("Job", { Company: "ACME", Role: "dev" });
    const c = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    const ra = await ensureApplicationFolder(a, "2026-10-01");
    if (!ra.ok) throw new Error(ra.error);
    addFile(a, `${ra.relativePath}/CV_1.pdf`);
    rmSync(ra.absolutePath, { recursive: true }); // only the DB knows it now
    const rb = await ensureApplicationFolder(b, "2026-10-02");
    expect(rb).toMatchObject({ ok: true, relativePath: "ACME_dev_2026-10_2" });
    addFile(b, "ACME_dev_2026-10_2/CV_1.pdf");
    expect(await ensureApplicationFolder(c, "2026-10-03")).toMatchObject({ ok: true, relativePath: "Acme_Dev_2026-10_3" });
  });

  it("is unique against a folder already on disk (manual, FR-5.11), case-insensitively", async () => {
    mkdirSync(join(root, "ACME_DEV_2026-10"));
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    const r = await ensureApplicationFolder(id, "2026-10-01");
    expect(r).toMatchObject({ ok: true, relativePath: "Acme_Dev_2026-10_2" });
    expect(readdirSync(root).sort()).toEqual(["ACME_DEV_2026-10", "Acme_Dev_2026-10_2"]);
  });

  it("refuses when the root is not set, missing, or the app does not exist", async () => {
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    expect(await ensureApplicationFolder(9999, "2026-10-01")).toMatchObject({ ok: false });
    await setFilesRoot(join(base, "missing"));
    expect(await ensureApplicationFolder(id, "2026-10-01")).toMatchObject({ ok: false });
    expect(existsSync(join(base, "missing"))).toBe(false);
    db.run(sql`delete from settings where key = 'files_root'`);
    expect(await ensureApplicationFolder(id, "2026-10-01")).toMatchObject({ ok: false });
  });

  it("refuses a bad upload date", async () => {
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    expect(await ensureApplicationFolder(id, "")).toMatchObject({ ok: false });
    expect(await ensureApplicationFolder(id, "soon")).toMatchObject({ ok: false });
    expect(await ensureApplicationFolder(id, "2026-02-30")).toMatchObject({ ok: false });
    expect(readdirSync(root)).toEqual([]);
  });

  it("refuses to create through a symlink pointing outside the root, and a stored path that escapes", async () => {
    const outside = join(base, "outside");
    mkdirSync(outside);
    const id = await mkApp("Job", { Company: "Acme", Role: "Dev" });
    symlinkSync(outside, join(root, "Acme_Dev_2026-10")); // name taken on disk -> next name is fine and stays inside
    const ok = await ensureApplicationFolder(id, "2026-10-01");
    expect(ok).toMatchObject({ ok: true, relativePath: "Acme_Dev_2026-10_2" });
    expect(readdirSync(outside)).toEqual([]);

    const other = await mkApp("Job", { Company: "X", Role: "Y" });
    addFile(other, "../outside/f.pdf"); // corrupted row
    expect(await ensureApplicationFolder(other, "2026-10-01")).toMatchObject({ ok: false });
    expect(readdirSync(outside)).toEqual([]);
  });
});
