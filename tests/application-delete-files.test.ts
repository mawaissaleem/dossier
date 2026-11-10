import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApplication as deleteAction } from "@/app/actions/application-state";
import { createApplication, getDeleteImpact } from "@/lib/db/applications";
import { files, settings, submissions, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;
const canBlockUnlink = process.platform !== "win32" && process.getuid?.() !== 0; // a read-only folder blocks unlink, except for root
const canSymlink = process.platform !== "win32"; // Windows needs a privilege to create symlinks
const posix = process.platform !== "win32"; // Windows leaves hard-linked files (cannot unlink read-only without chmod)
const mode = (p: string) => statSync(p).mode & 0o777;

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
async function del(id = appId) {
  const i = await getDeleteImpact(id);
  if (!i) throw new Error("no impact");
  return deleteAction(id, true, { cellCount: i.cellCount, fileCount: i.fileCount, submissionCount: i.submissionCount, noteCount: i.noteCount });
}
const appRows = () => db.select().from(files).all();

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-del-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  appId = await mkApp("Acme");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("deleting an application removes its files from disk", () => {
  it("removes every read-only file and the then-empty folder; other applications keep theirs", async () => {
    const a = await store("a.pdf", "1");
    const b = await store("b.pdf", "2");
    const other = await mkApp("Other");
    const o = await store("z.pdf", "3", other);
    const r = await del();
    expect(r).toMatchObject({ ok: true });
    expect("warning" in r).toBe(false);
    expect(existsSync(join(root, a.relativePath))).toBe(false);
    expect(existsSync(join(root, b.relativePath))).toBe(false);
    expect(existsSync(join(root, a.relativePath.split("/")[0]))).toBe(false);
    expect(existsSync(join(root, o.relativePath))).toBe(true);
    expect(appRows().map((f) => f.id)).toEqual([o.id]);
  });

  it("also works when the application has submissions linking its files, and with no files at all", async () => {
    const f = await store("a.pdf", "1");
    db.insert(submissions).values({ userId: "local", applicationId: appId, date: "2026-11-08" }).run();
    expect(await del()).toMatchObject({ ok: true });
    expect(existsSync(join(root, f.relativePath))).toBe(false);
    const empty = await mkApp("Empty");
    expect(await del(empty)).toEqual({ ok: true, trackId: expect.any(Number) });
  });

  it("keeps a file dropped in by hand (FR-5.11) and its folder, and says so", async () => {
    const f = await store("a.pdf", "1");
    const folder = join(root, f.relativePath.split("/")[0]);
    writeFileSync(join(folder, "mine.txt"), "keep me");
    const r = await del();
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining("was kept") });
    expect(readdirSync(folder)).toEqual(["mine.txt"]);
    expect(appRows()).toEqual([]);
  });

  it.runIf(canBlockUnlink)("a file that cannot be removed is reported, logged, and the delete still stands", async () => {
    const f = await store("a.pdf", "1");
    const folder = join(root, f.relativePath.split("/")[0]);
    chmodSync(folder, 0o555);
    try {
      const r = await del();
      expect(r).toMatchObject({ ok: true, warning: expect.stringMatching(/Deleted, but 1 file could not be removed from Acme/) });
      expect(existsSync(join(root, f.relativePath))).toBe(true);
      expect(mode(join(root, f.relativePath))).toBe(0o444); // still read-only after the failed unlink
      expect(console.error).toHaveBeenCalled();
      expect(appRows()).toEqual([]);
    } finally {
      chmodSync(folder, 0o755);
    }
  });

  it.runIf(canBlockUnlink)("a folder that cannot be removed is reported; its files are still removed", async () => {
    const f = await store("a.pdf", "1");
    chmodSync(root, 0o555);
    try {
      const r = await del();
      expect(r).toMatchObject({ ok: true, warning: expect.stringMatching(/^Deleted, but the folder Acme\S* could not be removed\.$/) });
      expect(existsSync(join(root, f.relativePath))).toBe(false);
      expect(appRows()).toEqual([]);
    } finally {
      chmodSync(root, 0o755);
    }
  });

  it("a file already missing from disk is not an error, only mentioned; the folder is still cleaned up", async () => {
    const f = await store("a.pdf", "1");
    const g = await store("b.pdf", "2");
    chmodSync(join(root, f.relativePath), 0o666);
    rmSync(join(root, f.relativePath));
    const r = await del();
    expect(r).toMatchObject({ ok: true, warning: "Deleted. 1 file was already missing from disk." });
    expect(existsSync(join(root, g.relativePath))).toBe(false);
    expect(existsSync(join(root, f.relativePath.split("/")[0]))).toBe(false);
  });

  it("a stored path that escapes the root is reported and nothing outside is touched", async () => {
    await store("a.pdf", "1");
    const outside = join(base, "secret.txt");
    writeFileSync(outside, "secret");
    db.update(files).set({ relativePath: "../secret.txt" }).run();
    const r = await del();
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining("could not be removed") });
    expect(existsSync(outside)).toBe(true);
  });

  it.runIf(canSymlink)("an application folder replaced by a symlink to another application's folder: the other's file survives", async () => {
    const a = await store("a.pdf", "mine");
    const other = await mkApp("Other");
    const o = await store("a.pdf", "theirs", other);
    expect(a.relativePath.split("/")[1]).toBe(o.relativePath.split("/")[1]); // same stored name in both folders
    const folder = join(root, a.relativePath.split("/")[0]);
    chmodSync(join(root, a.relativePath), 0o666);
    rmSync(folder, { recursive: true });
    symlinkSync(join(root, o.relativePath.split("/")[0]), folder);
    const r = await del();
    expect(r).toMatchObject({ ok: true, warning: expect.stringMatching(/^Deleted, but 1 file could not be removed from Acme\S* and the folder Acme\S* could not be removed\.$/) });
    expect(readFileSync(join(root, o.relativePath), "utf8")).toBe("theirs");
    expect(mode(join(root, o.relativePath))).toBe(0o444);
    expect(lstatSync(folder).isSymbolicLink()).toBe(true);
    expect(appRows().map((f) => f.id)).toEqual([o.id]);
  });

  it.runIf(canSymlink)("a stored file replaced by a symlink to another stored file: the link is left, the target keeps its content and mode", async () => {
    const a = await store("a.pdf", "mine");
    const other = await mkApp("Other");
    const o = await store("z.pdf", "theirs", other);
    chmodSync(join(root, a.relativePath), 0o666);
    rmSync(join(root, a.relativePath));
    symlinkSync(join(root, o.relativePath), join(root, a.relativePath));
    const r = await del();
    expect(r).toMatchObject({ ok: true, warning: expect.stringMatching(/^Deleted, but 1 file could not be removed from Acme\S*\.$/) });
    expect(readFileSync(join(root, o.relativePath), "utf8")).toBe("theirs");
    expect(mode(join(root, o.relativePath))).toBe(0o444);
    expect(lstatSync(join(root, a.relativePath)).isSymbolicLink()).toBe(true);
  });

  it.runIf(posix)("a stored file hard-linked to another application's file: only the name goes, the other keeps content and mode", async () => {
    const a = await store("a.pdf", "mine");
    const other = await mkApp("Other");
    const o = await store("z.pdf", "theirs", other);
    chmodSync(join(root, a.relativePath), 0o666);
    rmSync(join(root, a.relativePath));
    linkSync(join(root, o.relativePath), join(root, a.relativePath));
    const r = await del();
    expect(r).toEqual({ ok: true, trackId: expect.any(Number) });
    expect(existsSync(join(root, a.relativePath.split("/")[0]))).toBe(false);
    expect(readFileSync(join(root, o.relativePath), "utf8")).toBe("theirs");
    expect(mode(join(root, o.relativePath))).toBe(0o444);
    expect(appRows().map((f) => f.id)).toEqual([o.id]);
  });

  it.runIf(posix)("a stored file hard-linked to a private file outside the root: the outside file keeps its 0o600 mode and content", async () => {
    const a = await store("a.pdf", "mine");
    const outside = join(base, "private.txt");
    writeFileSync(outside, "secret", { mode: 0o600 });
    chmodSync(join(root, a.relativePath), 0o666);
    rmSync(join(root, a.relativePath));
    linkSync(outside, join(root, a.relativePath));
    await del();
    expect(existsSync(join(root, a.relativePath))).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("secret");
    expect(mode(outside)).toBe(0o600);
  });

  it("files folder unset: the rows are still deleted, the message says the files were left", async () => {
    const f = await store("a.pdf", "1");
    db.delete(settings).run();
    const r = await del();
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining("not set") });
    expect(r).toMatchObject({ warning: expect.stringMatching(/1 file in Acme\S* was left on disk\.$/) });
    expect(existsSync(join(root, f.relativePath))).toBe(true);
    expect(appRows()).toEqual([]);
  });

  it("a refused delete (stale count) touches no file", async () => {
    const f = await store("a.pdf", "1");
    const i = (await getDeleteImpact(appId))!;
    const r = await deleteAction(appId, true, { cellCount: i.cellCount, fileCount: i.fileCount + 1, submissionCount: i.submissionCount, noteCount: i.noteCount });
    expect(r.ok).toBe(false);
    expect(existsSync(join(root, f.relativePath))).toBe(true);
    expect(appRows()).toHaveLength(1);
  });
});
