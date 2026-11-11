import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/applications/[id]/zip/route";
import { createApplication } from "@/lib/db/applications";
import { applications, files, settings, tracks } from "@/lib/db/schema";
import { setFilesRoot } from "@/lib/db/settings";
import { deleteStoredFile } from "@/lib/files/remove";
import { storeUploadedFile } from "@/lib/files/store";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-form";
import { applicationZipName } from "@/lib/zip-name";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";
import { readZip } from "./helpers/zip";

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;

async function mkApp(title: string) {
  const trackId = db.select().from(tracks).all()[0].id;
  const r = await createApplication({ title, trackId, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
async function store(name: string, content: string, date = "2026-11-08", app = appId) {
  const r = await storeUploadedFile({ applicationId: app, file: new File([content], name), label: "CV", uploadDate: date });
  if (!r.ok || !("file" in r)) throw new Error("store failed");
  return r.file;
}
const edit = (rel: string, content: string) => { chmodSync(join(root, rel), 0o644); writeFileSync(join(root, rel), content); };
const get = (id: number | string, query = "", headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/api/applications/${id}/zip${query}`, { headers: { host: "localhost:3000", ...headers } }), { params: Promise.resolve({ id: String(id) }) } as never);
// Reads the response body into a temp file and parses it back with the test zip reader.
async function unzip(res: Response) {
  const f = join(base, "out.zip");
  writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  return readZip(f);
}
const integrityOf = (id: number) => db.select().from(files).where(eq(files.id, id)).get()!.integrity;

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-zip-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  appId = await mkApp("Acme");
});
afterEach(() => {
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("applicationZipName", () => {
  it("slugs the name and adds the local date", () => {
    expect(applicationZipName("Acme Corp / PhD #2", new Date(2026, 10, 11))).toBe("acme-corp-phd-2-files-20261111.zip");
    expect(applicationZipName("///", new Date(2026, 0, 5))).toBe("application-files-20260105.zip");
  });
});

describe("GET /api/applications/:id/zip", () => {
  it("zips exactly the live files, flat, under their stored names, with the right bytes and headers", async () => {
    const a = await store("My CV.pdf", "cv bytes é");
    const b = await store("letter.docx", "x".repeat(200_000), "2026-11-09");
    const gone = await store("old.txt", "old");
    await deleteStoredFile(gone.id, 0);
    const other = await store("z.pdf", "other app", "2026-11-09", await mkApp("Other"));
    const res = await get(appId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="[a-z0-9-]+-files-\d{8}\.zip"; filename\*=UTF-8''/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const z = await unzip(res);
    expect([...z.keys()].sort()).toEqual([a.storedName, b.storedName].sort());
    expect(z.get(a.storedName)!.toString()).toBe("cv bytes é");
    expect(z.get(b.storedName)!.length).toBe(200_000);
    expect(z.has(other.storedName)).toBe(false);
  });
  it("names the zip after the application folder", async () => {
    const a = await store("a.pdf", "1");
    const folder = a.relativePath.split("/").slice(0, -1).join("/");
    const cd = (await get(appId)).headers.get("content-disposition")!;
    expect(cd).toContain(applicationZipName(folder.split("/").pop()!, new Date()));
  });
  it("entry mode is a plain 0644 file", async () => {
    await store("a.pdf", "1");
    const buf = Buffer.from(await (await get(appId)).arrayBuffer());
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cd = buf.readUInt32LE(eocd + 16);
    expect(buf.readUInt32LE(cd + 38) >>> 16).toBe(0o100644);
  });
  it("records integrity ok for every file it added", async () => {
    const a = await store("a.pdf", "1");
    db.update(files).set({ integrity: "missing" }).where(eq(files.id, a.id)).run(); // stale flag
    await unzip(await get(appId));
    expect(integrityOf(a.id)).toBe("ok");
  });
  it("a changed file gives a 409 page listing it, no zip; ?anyway=1 includes the changed bytes", async () => {
    const a = await store("a.pdf", "original");
    const b = await store("b.pdf", "fine");
    edit(a.relativePath, "tampered");
    const res = await get(appId);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(a.storedName);
    expect(html).not.toContain(b.storedName);
    expect(html).toContain(`/api/applications/${appId}/zip?anyway=1`);
    expect(integrityOf(a.id)).toBe("mismatch");
    const z = await unzip(await get(appId, "?anyway=1"));
    expect(z.get(a.storedName)!.toString()).toBe("tampered");
    expect(z.get(b.storedName)!.toString()).toBe("fine");
    expect(integrityOf(a.id)).toBe("mismatch");
  });
  it("a missing file is listed on the page and skipped with ?anyway=1", async () => {
    const a = await store("a.pdf", "1");
    const b = await store("b.pdf", "2");
    rmSync(join(root, a.relativePath), { force: true });
    const page = await get(appId);
    expect(page.status).toBe(409);
    expect(await page.text()).toContain(`${a.storedName}: missing`);
    expect(integrityOf(a.id)).toBe("missing");
    const z = await unzip(await get(appId, "?anyway=1"));
    expect([...z.keys()]).toEqual([b.storedName]);
  });
  it("every file missing: the page has no anyway link and ?anyway=1 is a 409 message, never an empty zip", async () => {
    const a = await store("a.pdf", "1");
    const b = await store("b.pdf", "2");
    rmSync(join(root, a.relativePath), { force: true });
    rmSync(join(root, b.relativePath), { force: true });
    const page = await get(appId);
    expect(page.status).toBe(409);
    const html = await page.text();
    expect(html).toContain(`${b.storedName}: missing`);
    expect(html).not.toContain("anyway=1");
    expect(html).toContain("nothing to zip");
    const any = await get(appId, "?anyway=1");
    expect(any.status).toBe(409);
    expect(any.headers.get("content-type")).toContain("application/json");
    expect((await any.json()).error).toMatch(/nothing to zip/);
  });
  it("a file grown past the upload cap is listed as too large and left out with ?anyway=1", async () => {
    const a = await store("a.pdf", "1");
    const b = await store("b.pdf", "2");
    chmodSync(join(root, a.relativePath), 0o644);
    truncateSync(join(root, a.relativePath), MAX_UPLOAD_BYTES + 1); // sparse: nothing is written
    const html = await (await get(appId)).text();
    expect(html).toContain(`${a.storedName}: larger than any upload`);
    expect(html).toContain("anyway=1");
    expect([...(await unzip(await get(appId, "?anyway=1"))).keys()]).toEqual([b.storedName]);
  });
  it("404 with a message when the application has no live files (never an empty zip)", async () => {
    expect((await get(appId)).status).toBe(404);
    const a = await store("a.pdf", "1");
    await deleteStoredFile(a.id, 0);
    const res = await get(appId);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no files/);
    expect((await get(appId, "?anyway=1")).status).toBe(404);
  });
  it("404 for an unknown, bad or another user's application", async () => {
    await store("a.pdf", "1");
    expect((await get(appId + 100)).status).toBe(404);
    expect((await get("abc")).status).toBe(404);
    db.update(applications).set({ userId: "someone-else" }).where(eq(applications.id, appId)).run();
    expect((await get(appId)).status).toBe(404);
    db.update(applications).set({ userId: "local" }).where(eq(applications.id, appId)).run();
    db.update(files).set({ userId: "someone-else" }).run(); // his application, but the files are another user's: nothing to zip
    expect((await get(appId)).status).toBe(404);
  });
  it("403 for a non-local Host or a cross-site fetch, and 409 when the files folder is unset; all carry CORP", async () => {
    await store("a.pdf", "1");
    for (const r of [await get(appId, "", { host: "evil.example" }), await get(appId, "", { "sec-fetch-site": "cross-site" }), await get(appId, "", { "sec-fetch-site": "same-site" })]) {
      expect(r.status).toBe(403);
      expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
    db.delete(settings).run();
    const r = await get(appId);
    expect(r.status).toBe(409);
    const any = await get(appId, "?anyway=1"); // round 1 streamed an empty zip here
    expect(any.status).toBe(409);
    expect(any.headers.get("content-type")).toContain("application/json");
    expect(readFileSync(join(root, (await db.select().from(files).all())[0].relativePath)).toString()).toBe("1");
  });
});
