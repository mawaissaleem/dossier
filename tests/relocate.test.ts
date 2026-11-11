import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { backUpNow, saveBackupDestination } from "@/app/actions/backup";
import { fetchMoveImpact, moveFilesRoot, repointFilesRoot, saveFilesRoot } from "@/app/actions/settings";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as getZip } from "@/app/api/applications/[id]/zip/route";
import { createApplication } from "@/lib/db/applications";
import { listLiveFiles, switchFilesRoot } from "@/lib/db/files";
import { files, tracks } from "@/lib/db/schema";
import { getFilesRoot, setFilesRoot } from "@/lib/db/settings";
import { beginUpload, tryLock } from "@/lib/files/lock";
import { verifyStoredFile } from "@/lib/files/open";
import { moveStoredFiles } from "@/lib/files/relocate";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";
import { readZip } from "./helpers/zip";

vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, dest: string, appA: number, appB: number;
const sub = (name: string) => { const p = join(base, name); mkdirSync(p); return p; };
const exdev = async () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); };

async function mkApp(title: string) {
  const r = await createApplication({ title, trackId: db.select().from(tracks).all()[0].id, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function store(app: number, name: string, content: string, date = "2026-11-08") {
  const r = await storeUploadedFile({ applicationId: app, file: new File([content], name), label: "CV", uploadDate: date });
  if (!r.ok || !("file" in r)) throw new Error("store failed");
  return r.file;
}
const impact = async () => { const r = await fetchMoveImpact(); if (!r.ok) throw new Error(r.error); return { fileCount: r.fileCount, totalBytes: r.totalBytes }; };
const move = async (to: string) => moveFilesRoot(to, await impact());
const rows = () => db.select().from(files).all();

let f1: Awaited<ReturnType<typeof store>>, f2: Awaited<ReturnType<typeof store>>;
beforeEach(async () => {
  vi.mocked(refresh).mockClear();
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-reloc-"));
  root = sub("root");
  dest = sub("backups");
  await setFilesRoot(root);
  appA = await mkApp("Acme");
  appB = await mkApp("Beta");
  f1 = await store(appA, "cv.pdf", "alpha");
  f2 = await store(appB, "cv.pdf", "bravo bravo");
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

const asReq = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });
const open = (id: number) => getFile(asReq(`/api/files/${id}`), { params: Promise.resolve({ id: String(id) }) } as never);

describe("Move (AT-14, first way)", () => {
  it("moves by rename, switches the root, removes the old folders, and Open, zip and backup still work", async () => {
    const to = sub("new");
    const r = await move(to);
    expect(r).toMatchObject({ ok: true, path: to, moved: 2, renamed: 2, copied: 0, bytes: 16 });
    expect(await getFilesRoot()).toBe(to);
    expect(readdirSync(root)).toEqual([]); // the application folders are gone, the old root stays
    expect(r.ok && r.warnings.join(" ")).toMatch(/old folder .* itself was not removed/);

    expect((await open(f1.id)).status).toBe(200);
    expect(await verifyStoredFile(f1.id)).toMatchObject({ ok: true });
    const z = await getZip(asReq(`/api/applications/${appB}/zip`), { params: Promise.resolve({ id: String(appB) }) } as never);
    expect(z.status).toBe(200);
    writeFileSync(join(base, "z.zip"), Buffer.from(await z.arrayBuffer()));
    expect([...readZip(join(base, "z.zip")).values()].map(String)).toEqual(["bravo bravo"]);
    await saveBackupDestination(dest);
    expect(await backUpNow()).toMatchObject({ ok: true, fileCount: 2 });
    expect((await store(appA, "new.pdf", "after")).relativePath).toBeTruthy(); // uploads land in the new root
    expect(readdirSync(to).length).toBe(2);
  });

  it("copies across file systems (EXDEV), verifies each copy, keeps it read-only and removes the old copies only after the switch", async () => {
    const to = sub("new");
    const r = await moveStoredFiles(to, await impact(), { rename: exdev as never });
    expect(r).toMatchObject({ ok: true, moved: 2, renamed: 0, copied: 2 });
    for (const f of [f1, f2]) {
      expect(readFileSync(join(to, f.relativePath), "utf8")).toBe(f === f1 ? "alpha" : "bravo bravo");
      expect(statSync(join(to, f.relativePath)).mode & 0o222).toBe(0);
      expect(existsSync(join(root, f.relativePath))).toBe(false);
    }
    expect(readdirSync(root)).toEqual([]);
    expect(await getFilesRoot()).toBe(to);
  });

  it("a copy that fails its checksum rolls back: no partial copies, the old root and files stay in use", async () => {
    const to = sub("new");
    chmodSync(join(root, f2.relativePath), 0o644);
    writeFileSync(join(root, f2.relativePath), "tampered"); // no longer matches the recorded hash
    const r = await moveStoredFiles(to, await impact(), { rename: exdev as never });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/did not copy correctly.*Your files folder was not changed/);
    expect(readdirSync(to)).toEqual([]);
    expect(await getFilesRoot()).toBe(root);
    expect(readFileSync(join(root, f1.relativePath), "utf8")).toBe("alpha");
    expect(readFileSync(join(root, f2.relativePath), "utf8")).toBe("tampered");
  });

  it("a rename that fails half way puts the first file back and leaves the old root in use", async () => {
    const to = sub("new");
    let n = 0;
    const flaky = (async (a: string, b: string) => { if (++n === 2) throw new Error("disk says no"); return (await import("node:fs/promises")).rename(a, b); }) as never;
    const r = await moveStoredFiles(to, await impact(), { rename: flaky });
    expect(!r.ok && r.error).toMatch(/disk says no.*not changed/);
    expect(readdirSync(to)).toEqual([]);
    expect(existsSync(join(root, f1.relativePath)) && existsSync(join(root, f2.relativePath))).toBe(true);
    expect(await getFilesRoot()).toBe(root);
  });

  it("refuses when the live files changed during the move (the switch re-checks), and undoes it", async () => {
    const to = sub("new");
    const expected = await impact();
    // an upload that slipped in while the files were being moved: its row appears before the switch
    let n = 0;
    const racing = (async (a: string, b: string) => {
      if (++n === 2) await store(appA, "late.pdf", "late");
      return (await import("node:fs/promises")).rename(a, b);
    }) as never;
    const r = await moveStoredFiles(to, expected, { rename: racing });
    expect(!r.ok && r.error).toMatch(/changed while they were being moved/);
    expect(await getFilesRoot()).toBe(root);
    expect(readdirSync(to)).toEqual([]);
    expect(existsSync(join(root, f1.relativePath))).toBe(true);
  });

  it("refuses a non-empty, nested, containing, backup-overlapping or invalid folder and changes nothing", async () => {
    const full = sub("full");
    writeFileSync(join(full, "x"), "x");
    mkdirSync(join(root, "inside"));
    await saveBackupDestination(dest);
    const cases: [string, RegExp][] = [
      [full, /not empty/], [join(root, "inside"), /outside the current/], [root, /outside the current/], [base, /does not contain/],
      [dest, /backup folder/], [join(base, "nope"), /does not exist/], ["rel/dir", /full path/], ["   ", /full path/],
    ];
    for (const [to, re] of cases) {
      const r = await move(to);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(re);
    }
    const r = await moveFilesRoot(sub("empty"), { fileCount: 99, totalBytes: 1 });
    expect(!r.ok && r.error).toMatch(/changed since the confirmation/);
    expect((await moveFilesRoot(sub("e2"), undefined)).ok).toBe(false);
    expect(await getFilesRoot()).toBe(root);
    expect(rows().map((x) => x.relativePath).sort()).toEqual([f1.relativePath, f2.relativePath].sort());
    expect(existsSync(join(root, f1.relativePath))).toBe(true);
  });

  it("refuses when the current folder is gone (points to Re-point) or a stored file is missing", async () => {
    rmSync(join(root, f1.relativePath));
    expect(await move(sub("new"))).toMatchObject({ ok: false, error: expect.stringMatching(/missing from the current files folder/) });
    expect(readdirSync(join(base, "new"))).toEqual([]);
    renameSync(root, join(base, "moved"));
    expect(await move(sub("new2"))).toMatchObject({ ok: false, error: expect.stringMatching(/Re-point/) });
  });

  it("leaves files Dossier did not store, and says so", async () => {
    writeFileSync(join(root, f1.relativePath.split("/")[0], "mine.txt"), "hand-dropped");
    const to = sub("new");
    const r = await move(to);
    expect(r.ok && r.warnings.join(" ")).toMatch(/1 folder in .* still hold files Dossier did not store/);
    expect(readFileSync(join(root, f1.relativePath.split("/")[0], "mine.txt"), "utf8")).toBe("hand-dropped");
    expect(readdirSync(join(root, f1.relativePath.split("/")[0]))).toEqual(["mine.txt"]);
    expect(existsSync(join(to, f1.relativePath))).toBe(true);
  });

  it("ignores tombstoned files in both counting and moving", async () => {
    rmSync(join(root, f2.relativePath));
    db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, f2.id)).run();
    expect(await impact()).toEqual({ fileCount: 1, totalBytes: 5 });
    const r = await move(sub("new"));
    expect(r).toMatchObject({ ok: true, moved: 1 });
    expect(rows().find((x) => x.id === f2.id)?.deletedAt).not.toBeNull();
  });
});

describe("Re-point (AT-14, second way)", () => {
  it("accepts a folder the user moved by hand, then Open works", async () => {
    const to = join(base, "elsewhere");
    renameSync(root, to);
    const r = await repointFilesRoot(to);
    expect(r).toMatchObject({ ok: true, path: to, checked: 2 });
    expect(await getFilesRoot()).toBe(to);
    expect((await open(f2.id)).status).toBe(200);
  });

  it("refuses when a file is missing or has another size, lists them, and leaves the setting alone", async () => {
    const to = join(base, "elsewhere");
    renameSync(root, to);
    rmSync(join(to, f1.relativePath));
    chmodSync(join(to, f2.relativePath), 0o644);
    writeFileSync(join(to, f2.relativePath), "x");
    const r = await repointFilesRoot(to);
    expect(!r.ok && r.error).toContain(`${f1.relativePath} (missing)`);
    expect(!r.ok && r.error).toContain(`${f2.relativePath} (size differs)`);
    expect(!r.ok && r.error).toMatch(/Nothing was changed/);
    expect(await getFilesRoot()).toBe(root);
  });

  it("refuses an empty folder, and an invalid path", async () => {
    expect((await repointFilesRoot(sub("empty"))).ok).toBe(false);
    expect((await repointFilesRoot("nope")).ok).toBe(false);
    expect(await getFilesRoot()).toBe(root);
  });

  it("ignores tombstoned files (no bytes to find)", async () => {
    const to = join(base, "elsewhere");
    renameSync(root, to);
    rmSync(join(to, f2.relativePath));
    db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, f2.id)).run();
    expect(await repointFilesRoot(to)).toMatchObject({ ok: true, checked: 1 });
  });
});

describe("Save (first-time setup) and the switch", () => {
  it("without stored files a plain save still works and refreshes", async () => {
    db.delete(files).run();
    const to = sub("new");
    expect(await saveFilesRoot(to)).toEqual({ ok: true, path: to });
    expect(await getFilesRoot()).toBe(to);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("with stored files a different folder is refused (Move or Re-point), the same folder is fine", async () => {
    const r = await saveFilesRoot(sub("new"));
    expect(!r.ok && r.error).toMatch(/Move .* or Re-point/);
    expect(await getFilesRoot()).toBe(root);
    expect(await saveFilesRoot(`${root}/`)).toEqual({ ok: true, path: root });
  });

  it("switchFilesRoot refuses when the live set is not the verified one", async () => {
    const live = await listLiveFiles();
    await store(appA, "later.pdf", "later");
    expect(await switchFilesRoot("/x/y", live)).toBe(false);
    expect(await getFilesRoot()).toBe(root);
    expect(await switchFilesRoot(root, await listLiveFiles())).toBe(true);
  });
});

describe("the shared lock", () => {
  it("a move, re-point or save cannot start during a backup or restore, and a backup cannot start during a move", async () => {
    const held = tryLock("backup");
    if (!held.ok) throw new Error("lock");
    const to = sub("new");
    const e = await impact();
    for (const r of [await moveFilesRoot(to, e), await repointFilesRoot(to), await saveFilesRoot(to)]) expect(!r.ok && r.error).toMatch(/backup or restore is running/);
    expect(await getFilesRoot()).toBe(root);
    held.release();

    const mv = tryLock("move");
    if (!mv.ok) throw new Error("lock");
    await saveBackupDestination(dest);
    expect(await backUpNow()).toEqual({ ok: false, error: expect.stringMatching(/files folder is being changed/) });
    expect(readdirSync(dest)).toEqual([]);
    expect(await moveFilesRoot(to, e)).toMatchObject({ ok: false, error: expect.stringMatching(/already being changed/) });
    mv.release();
    expect((await backUpNow()).ok).toBe(true);
    expect((await moveFilesRoot(to, e)).ok).toBe(true); // released
  });

  it("uploads are refused during a move, and a move waits for running uploads", async () => {
    const mv = tryLock("move");
    if (!mv.ok) throw new Error("lock");
    const r = await storeUploadedFile({ applicationId: appA, file: new File(["z"], "z.pdf"), label: "CV", uploadDate: "2026-11-08" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/being changed/) });
    mv.release();

    const end = beginUpload();
    expect(end).not.toBeNull();
    const to = sub("new");
    expect(await moveFilesRoot(to, await impact())).toMatchObject({ ok: false, error: expect.stringMatching(/upload is in progress/) });
    end!();
    expect((await moveFilesRoot(to, await impact())).ok).toBe(true);
    expect(rows().length).toBe(2); // the refused upload left no row
  });
});
