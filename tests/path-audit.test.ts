import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as getZip } from "@/app/api/applications/[id]/zip/route";
import { createApplication } from "@/lib/db/applications";
import { files, tracks } from "@/lib/db/schema";
import { getFilesRoot, setFilesRoot } from "@/lib/db/settings";
import { validateBackupDestination } from "@/lib/files/backup";
import { moveStoredFiles, repointStoredFiles } from "@/lib/files/relocate";
import { deleteStoredFile } from "@/lib/files/remove";
import { checkBackup } from "@/lib/files/restore";
import { validateFilesRoot } from "@/lib/files/root";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";
import { readZip } from "./helpers/zip";

// Task 12.2 (NFR-10): hostile input against every consumer of a stored path or a typed path. The per-function rules are in
// files-paths.test.ts; this file proves each consumer (Open, zip, delete, move, re-point, upload, the typed-path validators) uses them.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, outside: string, appId: number;

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
const setPath = (id: number, relativePath: string) => db.update(files).set({ relativePath }).where(eq(files.id, id)).run();
const req = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });
const open = (id: number) => getFile(req(`/api/files/${id}`), { params: Promise.resolve({ id: String(id) }) } as never);
const zip = (id: number, q = "") => getZip(req(`/api/applications/${id}/zip${q}`), { params: Promise.resolve({ id: String(id) }) } as never);

// Every form a tampered files.relative_path might take to leave the root. "%2e%2e%2f" is not here: it is a harmless literal name (below).
const ESCAPES = ["..", "../secret.txt", "a/../../secret.txt", "/etc/passwd", "..\\secret.txt", "a\\..\\..\\secret.txt", "C:\\secret.txt", "a\0b/../../secret.txt", "./../secret.txt"];

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-audit-"));
  root = join(base, "root");
  outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(base, "secret.txt"), "TOPSECRET");
  writeFileSync(join(outside, "secret.txt"), "TOPSECRET");
  await setFilesRoot(root);
  appId = await mkApp("Acme");
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("a tampered stored path never reaches outside the files root", () => {
  it.each(ESCAPES)("Open serves nothing for %j", async (bad) => {
    const f = await store("a.pdf", "mine");
    setPath(f.id, bad);
    const res = await open(f.id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("TOPSECRET");
  });

  it("a percent-encoded name is just a name: it stays inside the root and is not decoded", async () => {
    const f = await store("a.pdf", "mine");
    writeFileSync(join(root, "%2e%2e%2fsecret.txt"), "LITERAL");
    setPath(f.id, "%2e%2e%2fsecret.txt");
    const res = await open(f.id);
    expect(res.status).toBe(409); // the file is inside the root, so it is served-or-flagged, never the parent's secret.txt
    expect(await res.text()).not.toContain("TOPSECRET");
    setPath(f.id, "%2e%2e/secret.txt"); // a folder named "%2e%2e" does not exist: missing, not the parent
    expect((await open(f.id)).status).toBe(404);
  });

  it.each(ESCAPES)("the zip route zips nothing for %j", async (bad) => {
    const f = await store("a.pdf", "mine");
    setPath(f.id, bad);
    for (const q of ["", "?anyway=1"]) {
      const res = await zip(appId, q);
      expect(res.headers.get("content-type")).not.toBe("application/zip");
      expect(await res.text()).not.toContain("TOPSECRET");
    }
  });

  it.each(ESCAPES)("deleting a file with stored path %j leaves the outside alone and the row live", async (bad) => {
    const f = await store("a.pdf", "mine");
    setPath(f.id, bad);
    const r = await deleteStoredFile(f.id, 0);
    expect(r.ok).toBe(false);
    expect(readFileSync(join(base, "secret.txt"), "utf8")).toBe("TOPSECRET");
    expect(db.select().from(files).where(eq(files.id, f.id)).get()).toMatchObject({ deletedAt: null });
  });

  it.each(ESCAPES)("Move and Re-point refuse stored path %j and change nothing", async (bad) => {
    const f = await store("a.pdf", "mine");
    setPath(f.id, bad);
    const to = join(base, "new-root");
    mkdirSync(to);
    const m = await moveStoredFiles(to, { fileCount: 1, totalBytes: f.sizeBytes });
    expect(m.ok).toBe(false);
    expect(readdirSync(to)).toEqual([]);
    expect(await getFilesRoot()).toBe(root);
    const p = await repointStoredFiles(to);
    expect(p.ok).toBe(false);
    expect(await getFilesRoot()).toBe(root);
    expect(readFileSync(join(base, "secret.txt"), "utf8")).toBe("TOPSECRET");
  });
});

describe("symlinks inside the files root that point outside", () => {
  it("an upload into an application folder that became a symlink is refused and writes nothing outside", async () => {
    const f = await store("a.pdf", "mine");
    const folder = join(root, f.relativePath.split("/")[0]);
    rmSync(folder, { recursive: true });
    symlinkSync(outside, folder);
    const before = readdirSync(outside);
    const r = await storeUploadedFile({ applicationId: appId, file: new File(["again"], "b.pdf"), label: "CV", uploadDate: "2026-11-08" });
    expect(r.ok).toBe(false);
    expect(readdirSync(outside)).toEqual(before);
    expect(db.select().from(files).all()).toHaveLength(1);
  });

  it("Open and the zip route do not follow a folder symlink to a file outside", async () => {
    const f = await store("a.pdf", "mine");
    const folder = join(root, f.relativePath.split("/")[0]);
    rmSync(folder, { recursive: true });
    symlinkSync(outside, folder);
    writeFileSync(join(outside, f.storedName), "TOPSECRET"); // the very name the row expects, one folder link away
    const res = await open(f.id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("TOPSECRET");
    const z = await zip(appId, "?anyway=1");
    expect(z.headers.get("content-type")).not.toBe("application/zip");
    expect(await z.text()).not.toContain("TOPSECRET");
  });

  it("Move refuses a stored file that is a symlink out of the root, and the outside file survives", async () => {
    const f = await store("a.pdf", "mine");
    rmSync(join(root, f.relativePath), { force: true });
    symlinkSync(join(outside, "secret.txt"), join(root, f.relativePath));
    const to = join(base, "new-root");
    mkdirSync(to);
    expect((await moveStoredFiles(to, { fileCount: 1, totalBytes: f.sizeBytes })).ok).toBe(false);
    expect(readdirSync(to)).toEqual([]);
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("TOPSECRET");
  });
});

describe("a tampered stored name cannot make a zip-slip entry in the download", () => {
  it.each(["../../evil.txt", "/etc/evil.txt", "a/b.txt", "..", "a\\b.txt", "C:evil.txt", "x\0y.txt"])("%j is left out of the zip", async (bad) => {
    const good = await store("ok.pdf", "fine");
    const other = await store("other.pdf", "other bytes");
    db.update(files).set({ storedName: bad }).where(eq(files.id, other.id)).run();
    const res = await zip(appId); // the page lists the problem; ?anyway=1 downloads the rest
    expect(res.status).toBe(409);
    const z = await zip(appId, "?anyway=1");
    expect(z.status).toBe(200);
    const f = join(base, "out.zip");
    writeFileSync(f, Buffer.from(await z.arrayBuffer()));
    expect([...readZip(f).keys()]).toEqual([good.storedName]);
  });

  it("when that is the only file there is no zip at all", async () => {
    const f = await store("only.pdf", "x");
    db.update(files).set({ storedName: "../../evil.txt" }).where(eq(files.id, f.id)).run();
    expect((await zip(appId, "?anyway=1")).status).toBe(409);
  });
});

describe("typed paths (files root, backup folder, restore zip)", () => {
  const HOSTILE = ["..", "../x", "..\\..\\x", "%2e%2e%2f%2e%2e%2fx", "~", "~/x", "a\0b", "C:\\x", "\\\\server\\share", "relative/dir", "/does/not/exist/../../x", ""];

  it.each(HOSTILE)("%j is refused by every validator and creates nothing", async (typed) => {
    const before = readdirSync(base);
    for (const r of [await validateFilesRoot(typed), await validateBackupDestination(typed), await checkBackup(typed), await repointStoredFiles(typed), await moveStoredFiles(typed, { fileCount: 0, totalBytes: 0 })]) {
      expect(r.ok).toBe(false);
    }
    expect(readdirSync(base)).toEqual(before);
    expect(await getFilesRoot()).toBe(root);
  });

  it("a .. that normalises into the project or its data folder is still refused", async () => {
    const proj = path.basename(process.cwd());
    for (const typed of [`${process.cwd()}/node_modules/..`, `${process.cwd()}/data/../data`, join(process.cwd(), "..", proj, "src", "..")]) {
      expect((await validateFilesRoot(typed)).ok, typed).toBe(false);
      expect((await validateBackupDestination(typed)).ok, typed).toBe(false);
    }
  });

  it("a symlink typed as the files root that leads into the project folder is refused", async () => {
    const link = join(base, "into-app");
    symlinkSync(process.cwd(), link);
    expect((await validateFilesRoot(link)).ok).toBe(false);
    expect((await validateBackupDestination(link)).ok).toBe(false);
  });

  it("a restore zip path that is a folder or does not exist is refused, and nothing is created there", async () => {
    expect((await checkBackup(outside)).ok).toBe(false); // a folder
    expect((await checkBackup(join(outside, "missing.zip"))).ok).toBe(false);
    expect(existsSync(join(outside, "missing.zip"))).toBe(false);
  });
});
