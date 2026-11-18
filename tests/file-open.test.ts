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

describe("original name length", () => {
  it("a 1000-character name is stored capped at 255 with its extension; the stored name rule is unchanged", async () => {
    const long = "n".repeat(996) + ".pdf";
    const f = await store(long, "1", "2026-11-08");
    const r = db.select().from(files).where(eq(files.id, f.id)).get()!;
    expect(r.originalName).toHaveLength(255);
    expect(r.originalName.endsWith(".pdf")).toBe(true);
    expect(f.storedName).toMatch(/^01-20261108-n+\.pdf$/);
  });
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
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it.each([["pic.png", "image/png"], ["notes.txt", "text/plain; charset=utf-8"]])("%s is inline and keeps the sandbox", async (name, type) => {
    const res = await get((await store(name, "x", "2026-11-08")).id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; frame-ancestors 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it.each([["page.html", "<script>alert(1)</script>"], ["pic.svg", "<svg onload=alert(1)/>"], ["x.js", "alert(1)"], ["doc.docx", "PK"]])("%s is an attachment, sandboxed and nosniff", async (name, body) => {
    const f = await store(name, body, "2026-11-08");
    const res = await get(f.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; frame-ancestors 'self'");
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
  it("a frame request from Dossier itself (same-origin, Sec-Fetch-Dest: iframe) is served with the PDF's own headers; one from another site or localhost port is refused", async () => {
    const f = await store("a.pdf", "secret cv", "2026-11-08");
    const ok = await get(f.id, { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("secret cv");
    expect(ok.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(ok.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(ok.headers.get("content-disposition")).toMatch(/^inline;/);
    for (const site of ["cross-site", "same-site"]) {
      const res = await get(f.id, { "sec-fetch-site": site, "sec-fetch-dest": "iframe" });
      expect(res.status, site).toBe(403);
      expect(await res.text()).not.toContain("secret cv");
    }
  });
  it("?download=1 sends the same bytes as an attachment, still hash-checked", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    const dl = (q: string) => GET(new NextRequest(`http://localhost:3000/api/files/${f.id}${q}`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(f.id) }) } as never);
    const ok = await dl("?download=1");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
    expect(await ok.text()).toBe("original");
    chmodSync(join(root, f.relativePath), 0o644);
    writeFileSync(join(root, f.relativePath), "tampered");
    const bad = await dl("?download=1");
    expect(bad.status).toBe(409);
    expect(await bad.text()).not.toContain("tampered");
  });
  it("the changed-file and folder-missing pages can be framed only by Dossier, and their links work in a frame (open anyway stays in it, back and settings leave it)", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    chmodSync(join(root, f.relativePath), 0o644);
    writeFileSync(join(root, f.relativePath), "tampered");
    const changed = await get(f.id, { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" });
    expect(changed.status).toBe(409);
    expect(changed.headers.get("content-security-policy")).toMatch(/frame-ancestors 'self'$/);
    expect(changed.headers.get("content-security-policy")).not.toMatch(/sandbox/); // a sandboxed frame's own links would count as cross-site
    const html = await changed.text();
    expect(html).toContain(`<a href="/api/files/${f.id}?anyway=1">Open anyway</a>`); // no target: loads in the frame, same-origin
    expect(html).toContain('target="_top"');
    db.delete(settings).run();
    const setup = await get(f.id, { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" });
    expect(setup.headers.get("content-security-policy")).toMatch(/frame-ancestors 'self'$/);
  });
  it("409 when the files folder is not set", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    db.delete(settings).run();
    const res = await get(f.id);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toMatch(/Choose the files folder in Settings[\s\S]*Back to the application/);
  });
  it("404 with a clear message when the file is gone from disk, or is a folder", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    const abs = join(root, f.relativePath);
    chmodSync(abs, 0o666);
    rmSync(abs);
    const res = await get(f.id);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`${f.storedName} is missing`);
    mkdirSync(abs);
    expect((await get(f.id)).status).toBe(404);
  });
  it("a file missing from disk (404) and an unreadable one (500) get the themed, frameable problem page with a way back; unknown ids and 403 stay JSON", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    const abs = join(root, f.relativePath);
    const asFrame = { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" };
    const page = async (res: Response, status: number, title: string) => {
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain(`<a href="/applications/${appId}" target="_top">Back to the application</a>`);
      return html;
    };
    if (process.platform !== "win32" && process.getuid?.() !== 0) { // root reads anything and Windows ignores chmod 000, so the unreadable case cannot be made there
      chmodSync(abs, 0o000);
      await page(await get(f.id, asFrame), 500, "This file could not be read");
    }
    chmodSync(abs, 0o666);
    rmSync(abs);
    const html = await page(await get(f.id, asFrame), 404, "This file is missing");
    expect(html).toContain(`${f.storedName} is missing from the files folder`);
    await page(await get(f.id), 404, "This file is missing"); // a new tab gets the same page
    const unknown = await get(f.id + 100);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    const cross = await get(f.id, { "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    expect(cross.headers.get("content-type")).toContain("application/json");
  });
  it("Open anyway on the changed-file page keeps the download when it was reached with ?download=1, and not otherwise", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    chmodSync(join(root, f.relativePath), 0o644);
    writeFileSync(join(root, f.relativePath), "tampered");
    const req = (q: string) => GET(new NextRequest(`http://localhost:3000/api/files/${f.id}${q}`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(f.id) }) } as never);
    expect(await (await req("?download=1")).text()).toContain(`<a href="/api/files/${f.id}?anyway=1&download=1">Open anyway</a>`);
    expect(await (await req("")).text()).toContain(`<a href="/api/files/${f.id}?anyway=1">Open anyway</a>`);
    const any = await req("?anyway=1&download=1");
    expect(any.status).toBe(200);
    expect(any.headers.get("content-disposition")).toMatch(/^attachment;/);
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
    expect(html).toContain(`<a href="/applications/${appId}" target="_top">Back to the application</a>`);
    expect(html).toContain("prefers-color-scheme:light");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(row(f.id).integrity).toBe("mismatch");
  });
  it("a tampered stored hash is escaped on the changed page: markup shows as text", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    db.$client.pragma("ignore_check_constraints = ON"); // the CHECK on files.sha256 would refuse this; a hand-edited database file would not
    db.update(files).set({ sha256: "<style>x</style><script>" }).where(eq(files.id, f.id)).run();
    const html = await (await get(f.id)).text();
    expect(html).not.toMatch(/<style>x|<script>/);
    expect(html).toContain("Expected hash &#60;style&#62;x&#60;");
  });
  it("a files folder that no longer exists gets the themed page (409) with the Re-point message and a way back; a path that escapes the root is still refused (404)", async () => {
    const f = await store("a.pdf", "1", "2026-11-08");
    rmSync(root, { recursive: true, force: true });
    const res = await get(f.id);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toMatch(/files folder was not found\. If you moved it, use Re-point in Settings/);
    expect(html).toContain('<a href="/settings" target="_top">Open Settings</a>');
    expect(html).toContain(`<a href="/applications/${appId}" target="_top">Back to the application</a>`);
    expect(await verifyStoredFile(f.id)).toMatchObject({ ok: false, kind: "setup" });
    mkdirSync(root);
    db.update(files).set({ relativePath: "../outside.pdf" }).where(eq(files.id, f.id)).run();
    const esc = await get(f.id);
    expect(esc.status).toBe(404);
    expect((await esc.json()).error).toMatch(/not allowed/);
  });
  it("open anyway serves the changed bytes with the usual safe headers", async () => {
    const f = await store("a.pdf", "original", "2026-11-08");
    edit(f.relativePath, "tampered");
    const res = await GET(new NextRequest(`http://localhost:3000/api/files/${f.id}?anyway=1`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: String(f.id) }) } as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("tampered");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'self'");
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
