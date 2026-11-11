import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/files/[id]/route";
import { createApplication } from "@/lib/db/applications";
import { listApplicationFiles } from "@/lib/db/files";
import { files, settings, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import { verifyStoredFile } from "@/lib/files/open";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-form";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;

async function mkApp(title: string) {
  const trackId = db.select().from(tracks).all()[0].id;
  const r = await createApplication({ title, trackId, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function store(name: string, content: string, date: string, label = "CV", app = appId) {
  const r = await storeUploadedFile({ applicationId: app, file: new File([content], name), label, uploadDate: date });
  if (!r.ok || !("file" in r)) throw new Error("store failed");
  return r.file;
}
const get = (id: number | string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/api/files/${id}`, { headers: { host: "localhost:3000", ...headers } }), { params: Promise.resolve({ id: String(id) }) } as never);

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-open-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  appId = await mkApp("Acme");
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("listApplicationFiles", () => {
  it("lists newest upload date first, then seq, and only this application's files of this user", async () => {
    const a = await store("a.pdf", "1", "2026-11-01");
    const b = await store("b.pdf", "2", "2026-11-05", "Cover letter");
    const c = await store("a.pdf", "3", "2026-11-05"); // same date as b, other base name: seq 1 as well, so id breaks the tie
    const d = await store("a.pdf", "4", "2026-11-05"); // seq 2
    const other = await mkApp("Other");
    await store("z.pdf", "5", "2026-11-09", "CV", other);
    const list = await listApplicationFiles(appId);
    expect(list.map((f) => f.id)).toEqual([b.id, c.id, d.id, a.id]);
    expect(list[0]).toEqual({ id: b.id, originalName: "b.pdf", storedName: b.storedName, label: "Cover letter", uploadDate: "2026-11-05", sizeBytes: 1, integrity: "ok", checkedAt: null });
    db.update(files).set({ userId: "someone-else" }).where(eq(files.id, a.id)).run();
    expect((await listApplicationFiles(appId)).map((f) => f.id)).toEqual([b.id, c.id, d.id]);
  });
  it("lists rows, not the folder: a file dropped in by hand is ignored", async () => {
    const a = await store("a.pdf", "1", "2026-11-01");
    writeFileSync(join(root, a.relativePath.split("/")[0], "dropped.pdf"), "x");
    expect((await listApplicationFiles(appId)).map((f) => f.id)).toEqual([a.id]);
    expect(await listApplicationFiles(999)).toEqual([]);
  });
});

describe("GET /api/files/:id", () => {
  it("streams a pdf inline with the exact bytes and the hardening headers", async () => {
    const bytes = "%PDF-1.4 fake é";
    const f = await store("My CV.pdf", bytes, "2026-11-08");
    const res = await get(f.id);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(bytes);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="01-20261108-My_CV.pdf"; filename*=UTF-8''01-20261108-My_CV.pdf`);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(bytes)));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it.each([["pic.png", "image/png"], ["notes.txt", "text/plain; charset=utf-8"]])("%s is inline and keeps the sandbox", async (name, type) => {
    const res = await get((await store(name, "x", "2026-11-08")).id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it.each([["page.html", "<script>alert(1)</script>"], ["pic.svg", "<svg onload=alert(1)/>"], ["x.js", "alert(1)"], ["doc.docx", "PK"]])("%s is an attachment, sandboxed and nosniff", async (name, body) => {
    const f = await store(name, body, "2026-11-08");
    const res = await get(f.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("404 for an unknown id, a bad id and another user's file", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    expect((await get(f.id + 100)).status).toBe(404);
    expect((await get("abc")).status).toBe(404);
    expect((await get("-1")).status).toBe(404);
    db.update(files).set({ userId: "someone-else" }).where(eq(files.id, f.id)).run();
    expect((await get(f.id)).status).toBe(404);
  });
  it("403 for a Host that is not local, before anything is read", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    for (const host of ["evil.example", "evil.example:3000", "localhost.evil.example"]) {
      const res = await get(f.id, { host });
      expect(res.status).toBe(403);
      expect(res.headers.get("content-disposition")).toBeNull();
    }
  });
  it("Cross-Origin-Resource-Policy: same-origin on success and on every error", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    const corp = (r: Response) => r.headers.get("cross-origin-resource-policy");
    expect(corp(await get(f.id))).toBe("same-origin");
    expect(corp(await get(f.id + 100))).toBe("same-origin"); // 404
    expect(corp(await get("abc"))).toBe("same-origin"); // 404
    expect(corp(await get(f.id, { host: "evil.example" }))).toBe("same-origin"); // 403 host
    expect(corp(await get(f.id, { "sec-fetch-site": "cross-site" }))).toBe("same-origin"); // 403 fetch site
    db.delete(settings).run();
    expect(corp(await get(f.id))).toBe("same-origin"); // 409
  });
  it("Sec-Fetch-Site: cross-site and same-site (another localhost port) get 403 without the file; same-origin, none and no header get it", async () => {
    const f = await store("a.pdf", "secret cv", "2026-11-08");
    for (const site of ["cross-site", "same-site"]) {
      const res = await get(f.id, { "sec-fetch-site": site });
      expect(res.status, site).toBe(403);
      expect(res.headers.get("content-disposition")).toBeNull();
      expect(await res.text()).not.toContain("secret cv");
    }
    for (const site of ["same-origin", "none"]) {
      const res = await get(f.id, { "sec-fetch-site": site });
      expect(res.status, site).toBe(200);
      expect(await res.text()).toBe("secret cv");
    }
    expect((await get(f.id)).status).toBe(200);
  });
  it("409 when the files folder is not set", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    db.delete(settings).run();
    const res = await get(f.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Settings/);
  });
  it("404 with a clear message when the file is gone from disk, or is a folder", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    const abs = join(root, f.relativePath);
    chmodSync(abs, 0o666);
    rmSync(abs);
    const res = await get(f.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain(`${f.storedName} is missing`);
    mkdirSync(abs);
    expect((await get(f.id)).status).toBe(404);
  });
  it("refuses a tampered relative_path (../ and absolute) and a symlink out of the root", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    writeFileSync(join(base, "secret.txt"), "secret");
    for (const bad of ["../secret.txt", "/etc/passwd", "a/../../secret.txt", "..\\secret.txt", ""]) {
      db.update(files).set({ relativePath: bad }).where(eq(files.id, f.id)).run();
      const res = await get(f.id);
      expect(res.status, bad).toBe(404);
      expect(await res.text()).not.toContain("secret");
    }
    symlinkSync(base, join(root, "link"));
    db.update(files).set({ relativePath: "link/secret.txt" }).where(eq(files.id, f.id)).run();
    const res = await get(f.id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("secret");
  });
});

describe("hash verification on open (8.6)", () => {
  const row = (id: number) => db.select().from(files).where(eq(files.id, id)).get()!;
  const edit = (relativePath: string, content: string) => {
    chmodSync(join(root, relativePath), 0o644);
    writeFileSync(join(root, relativePath), content);
  };
  it("an unchanged file is served and recorded ok", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    expect(row(f.id).checkedAt).toBeNull();
    const res = await get(f.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("original");
    expect(row(f.id).integrity).toBe("ok");
    expect(row(f.id).checkedAt).toBeInstanceOf(Date);
  });
  it("an edited file gets 409 with the expected and found hashes and none of its bytes; the state is mismatch", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    edit(f.relativePath, "tampered same length!!");
    const res = await get(f.id);
    expect(res.status).toBe(409);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("content-disposition")).toBeNull();
    const html = await res.text();
    expect(html).not.toContain("tampered");
    expect(html).toContain(f.storedName);
    expect(html).toContain(row(f.id).sha256.slice(0, 12));
    expect(html).toContain(`/api/files/${f.id}?anyway=1`);
    expect(row(f.id).integrity).toBe("mismatch");
  });
  it("open anyway serves the changed bytes with the usual safe headers", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    edit(f.relativePath, "tampered");
    const res = await GET(new NextRequest(`http://localhost:3000/api/files/${f.id}?anyway=1`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(f.id) }) } as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("tampered");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(row(f.id).integrity).toBe("mismatch");
  });
  it("a file deleted outside the app is missing (404) and recorded; put back with its original bytes it is ok again", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    const abs = join(root, f.relativePath);
    chmodSync(abs, 0o666);
    rmSync(abs);
    expect((await get(f.id)).status).toBe(404);
    expect(row(f.id).integrity).toBe("missing");
    writeFileSync(abs, "original");
    expect((await get(f.id)).status).toBe(200);
    expect(row(f.id).integrity).toBe("ok");
  });
  it("an edited file restored to its original bytes goes back to ok", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    edit(f.relativePath, "tampered");
    expect((await get(f.id)).status).toBe(409);
    edit(f.relativePath, "original");
    expect((await get(f.id)).status).toBe(200);
    expect(row(f.id).integrity).toBe("ok");
  });
  it("another user's file is 404 and its state is not touched", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    edit(f.relativePath, "tampered");
    db.update(files).set({ userId: "someone-else" }).where(eq(files.id, f.id)).run();
    expect((await get(f.id)).status).toBe(404);
    expect(row(f.id).integrity).toBe("ok");
  });
  it("verifyStoredFile reports without a Response and a file over the upload cap is a mismatch that is not read", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    const r = await verifyStoredFile(f.id);
    expect(r).toMatchObject({ ok: true, integrity: "ok", expected: row(f.id).sha256 });
    expect((await verifyStoredFile(f.id + 100)).ok).toBe(false);
    edit(f.relativePath, "x");
    truncateSync(join(root, f.relativePath), MAX_UPLOAD_BYTES + 1); // sparse: no real 50 MB written
    const big = await verifyStoredFile(f.id);
    expect(big).toMatchObject({ ok: true, integrity: "mismatch", found: null, bytes: null });
    expect((await get(f.id)).status).toBe(409);
  });
});
