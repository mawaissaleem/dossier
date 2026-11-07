import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/applications/[id]/files/route";
import { createApplication } from "@/lib/db/applications";
import { files, tracks } from "@/lib/db/schema";
import { getFilesRoot, setFilesRoot } from "@/lib/db/settings";
import { storeFileUnlocked, storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

// Hooks into the file calls of lib/files/store.ts; null = the real call.
const fsHooks = vi.hoisted(() => ({ link: null as null | (() => Promise<void>), onChmod: null as null | ((path: string, mode: number) => void) }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    link: (a: string, b: string) => (fsHooks.link ? fsHooks.link() : real.link(a, b)),
    chmod: (p: string, m: number) => { fsHooks.onChmod?.(p, m); return real.chmod(p, m); },
  };
});

let db: ReturnType<typeof useTestDb>;
let base: string, root: string, appId: number;
const DATE = "2026-11-08";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const readOnly = process.platform !== "win32"; // POSIX mode bits; Windows only has the read-only attribute

async function mkApp(title = "T", track = "Job") {
  const trackId = db.select().from(tracks).all().find((t) => t.name === track)!.id;
  const r = await createApplication({ title, trackId, values: [] });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

type Part = [name: string, content: Buffer | string];
function post(id: number | string, parts: Part[], fields: Record<string, string> = { label: "CV", uploadDate: DATE }, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [name, content] of parts) form.append("files", new File([new Uint8Array(typeof content === "string" ? Buffer.from(content) : content)], name));
  return POST(
    new NextRequest(`http://localhost:3000/api/applications/${id}/files`, { method: "POST", body: form, headers: { host: "localhost:3000", origin: "http://localhost:3000", ...headers } }),
    { params: Promise.resolve({ id: String(id) }) } as never,
  );
}
const upload = (name: string, content: Buffer | string = "x", fields?: Record<string, string>) => post(appId, [[name, content]], fields);
const rows = () => db.select().from(files).all();
const allEntries = () => readdirSync(root, { recursive: true }).map(String);

beforeEach(async () => {
  db = useTestDb();
  runSeed();
  base = mkdtempSync(join(tmpdir(), "dossier-upload-"));
  root = join(base, "root");
  mkdirSync(root);
  await setFilesRoot(root);
  appId = await mkApp("Acme Robotics");
});
afterEach(() => {
  fsHooks.link = null;
  fsHooks.onChmod = null;
  vi.restoreAllMocks();
  dropTestDb();
  rmSync(base, { recursive: true, force: true });
});

describe("POST /api/applications/:id/files", () => {
  it("stores the file as NN-YYYYMMDD-name.ext in an app folder, with hash, size, read-only mode and a matching row", async () => {
    const content = Buffer.from("hello cv");
    const res = await upload("My CV.pdf", content);
    expect(res.status).toBe(201);
    const { files: out } = await res.json();
    expect(out).toHaveLength(1);
    const row = rows()[0];
    expect(out[0]).toEqual({ id: row.id, storedName: "01-20261108-My_CV.pdf", relativePath: "Acme_Robotics_2026-11/01-20261108-My_CV.pdf", sizeBytes: 8, sha256: sha(content) });
    expect(row).toMatchObject({ originalName: "My CV.pdf", label: "CV", uploadDate: DATE, baseName: "My_CV", extension: "pdf", seq: 1, sizeBytes: 8, sha256: sha(content), relativePath: out[0].relativePath, userId: "local" });
    const disk = join(root, out[0].relativePath);
    expect(readFileSync(disk)).toEqual(content);
    if (readOnly) expect(statSync(disk).mode & 0o777).toBe(0o444);
    expect(readdirSync(join(root, "Acme_Robotics_2026-11"))).toEqual(["01-20261108-My_CV.pdf"]); // no temp file left
  });

  it("AT-5: CV.docx and CV.pdf are both 01, a changed CV.pdf the same day is 02", async () => {
    const names = async (r: Response) => (await r.json()).files.map((f: { storedName: string }) => f.storedName);
    expect(await names(await post(appId, [["CV.docx", "a"], ["CV.pdf", "b"]]))).toEqual(["01-20261108-CV.docx", "01-20261108-CV.pdf"]);
    expect(await names(await upload("CV.pdf", "changed"))).toEqual(["02-20261108-CV.pdf"]);
    expect(await names(await upload("CV.pdf", "other day", { label: "CV", uploadDate: "2026-11-09" }))).toEqual(["01-20261109-CV.pdf"]);
    expect(new Set(rows().map((r) => r.relativePath.split("/")[0])).size).toBe(1); // one folder for the application
  });

  it("AT-6: a file already named in the convention does not get a doubled prefix", async () => {
    const r = await upload("03-20261001-CV.pdf");
    expect((await r.json()).files[0].storedName).toBe("01-20261108-CV.pdf");
    expect(rows()[0].originalName).toBe("03-20261001-CV.pdf");
    expect((await (await upload("CV.pdf")).json()).files[0].storedName).toBe("02-20261108-CV.pdf");
  });

  it("stores identical content again under a new seq (FR-5.7 duplicate warning is 5.9)", async () => {
    await upload("CV.pdf", "same");
    const r = await upload("CV.pdf", "same");
    expect((await r.json()).files[0].storedName).toBe("02-20261108-CV.pdf");
  });

  it("defaults the date to today when none is sent", async () => {
    const r = await upload("a.txt", "x", { label: "CV" });
    expect((await r.json()).files[0].storedName).toMatch(/^01-\d{8}-a\.txt$/);
  });

  it("never uses the request's name as a path: traversal names stay inside the application folder", async () => {
    for (const name of ["../../evil.pdf", "a/b.pdf", "C:\\x.pdf", "..\\..\\y.pdf", "/etc/passwd"]) {
      const r = await upload(name);
      expect(r.status).toBe(201);
    }
    const stored = rows();
    expect(stored.map((r) => r.storedName)).toEqual(expect.arrayContaining(["01-20261108-evil.pdf", "01-20261108-b.pdf", "01-20261108-x.pdf", "01-20261108-y.pdf", "01-20261108-passwd"]));
    for (const r of stored) expect(r.relativePath).toMatch(/^Acme_Robotics_2026-11\/[^/]+$/);
    expect(readdirSync(base)).toEqual(["root"]);
    expect(readdirSync(root)).toEqual(["Acme_Robotics_2026-11"]);
    expect(readdirSync(join(root, "Acme_Robotics_2026-11"))).toHaveLength(5);
  });

  it("stores an empty file", async () => {
    const r = await upload("empty.txt", "");
    expect((await r.json()).files[0]).toMatchObject({ sizeBytes: 0, sha256: sha("") });
  });

  describe("request safety", () => {
    it("403 for a non-local Host, a foreign or missing Origin, and writes nothing", async () => {
      expect((await post(appId, [["a.pdf", "x"]], undefined, { host: "evil.example" })).status).toBe(403);
      expect((await post(appId, [["a.pdf", "x"]], undefined, { origin: "http://evil.example" })).status).toBe(403);
      expect((await post(appId, [["a.pdf", "x"]], undefined, { origin: "http://localhost:3001" })).status).toBe(403);
      const noOrigin = new NextRequest("http://localhost:3000/api/applications/1/files", { method: "POST", body: new FormData(), headers: { host: "localhost:3000" } });
      expect((await POST(noOrigin, { params: Promise.resolve({ id: String(appId) }) } as never)).status).toBe(403);
      expect(rows()).toHaveLength(0);
      expect(allEntries()).toEqual([]);
    });
    it("accepts Sec-Fetch-Site: same-origin when no Origin is sent", async () => {
      const req = new NextRequest(`http://localhost:3000/api/applications/${appId}/files`, { method: "POST", body: (() => { const f = new FormData(); f.set("label", "CV"); f.append("files", new File(["x"], "a.pdf")); return f; })(), headers: { host: "localhost:3000", "sec-fetch-site": "same-origin" } });
      expect((await POST(req, { params: Promise.resolve({ id: String(appId) }) } as never)).status).toBe(201);
    });
    it("413 over 50 MB (real body, no Content-Length) and writes nothing", async () => {
      const res = await upload("big.bin", Buffer.alloc(50 * 1024 * 1024 + 1));
      expect(res.status).toBe(413);
      expect(rows()).toHaveLength(0);
      expect(allEntries()).toEqual([]);
    });
    it("413 when Content-Length already says too much, before reading the body", async () => {
      const res = await post(appId, [["a.pdf", "x"]], undefined, { "content-length": String(60 * 1024 * 1024) });
      expect(res.status).toBe(413);
      expect(allEntries()).toEqual([]);
    });
    it("404 for an unknown application, another id format, or a missing one", async () => {
      for (const id of [9999, "abc", "1e3", "-1", "0x10"]) expect((await post(id, [["a.pdf", "x"]])).status).toBe(404);
      expect(allEntries()).toEqual([]);
    });
    it("400 for a body that is not multipart", async () => {
      const req = new NextRequest(`http://localhost:3000/api/applications/${appId}/files`, { method: "POST", body: "{}", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" } });
      expect((await POST(req, { params: Promise.resolve({ id: String(appId) }) } as never)).status).toBe(400);
    });
  });

  describe("validation", () => {
    it("400 with field errors for a bad date, a bad or missing label, and no files", async () => {
      let r = await upload("a.pdf", "x", { label: "CV", uploadDate: "2026-02-30" });
      expect([r.status, (await r.json()).errors.uploadDate]).toEqual([400, expect.any(String)]);
      r = await upload("a.pdf", "x", { uploadDate: DATE });
      expect([r.status, (await r.json()).errors.label]).toEqual([400, expect.any(String)]);
      r = await upload("a.pdf", "x", { label: "a\nb", uploadDate: DATE });
      expect(r.status).toBe(400);
      r = await post(appId, [], { label: "CV" });
      expect([r.status, (await r.json()).errors.files]).toEqual([400, expect.any(String)]);
      expect(rows()).toHaveLength(0);
      expect(allEntries()).toEqual([]);
    });
    it("the empty part a browser sends for a file input with nothing chosen is not a file: 400, no row, no folder", async () => {
      const b = "----dossierBoundary";
      const body = [
        `--${b}`, 'Content-Disposition: form-data; name="label"', "", "CV",
        `--${b}`, 'Content-Disposition: form-data; name="files"; filename=""', "Content-Type: application/octet-stream", "", "",
        `--${b}--`, "",
      ].join("\r\n"); // a raw body: new File([], "") built in Node is not sent this way
      const req = new NextRequest(`http://localhost:3000/api/applications/${appId}/files`, {
        method: "POST", body, headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": `multipart/form-data; boundary=${b}` },
      });
      const r = await POST(req, { params: Promise.resolve({ id: String(appId) }) } as never);
      expect([r.status, (await r.json()).errors.files]).toEqual([400, expect.any(String)]);
      expect(rows()).toHaveLength(0);
      expect(allEntries()).toEqual([]);
    });
    it("a plain text value in the files field is not a file", async () => {
      const form = new FormData();
      form.set("label", "CV");
      form.append("files", "not a file");
      const req = new NextRequest(`http://localhost:3000/api/applications/${appId}/files`, { method: "POST", body: form, headers: { host: "localhost:3000", origin: "http://localhost:3000" } });
      expect((await POST(req, { params: Promise.resolve({ id: String(appId) }) } as never)).status).toBe(400);
    });
  });

  describe("files root", () => {
    it("409 pointing to Settings when the root is unset", async () => {
      dropTestDb();
      db = useTestDb();
      runSeed();
      appId = await mkApp();
      expect(await getFilesRoot()).toBeNull();
      const r = await upload("a.pdf");
      expect(r.status).toBe(409);
      expect((await r.json()).error).toMatch(/Settings/);
    });
    it("409 and no row when the root folder is gone", async () => {
      rmSync(root, { recursive: true });
      const r = await upload("a.pdf");
      expect(r.status).toBe(409);
      expect(rows()).toHaveLength(0);
    });
  });

  describe("failure cleanup", () => {
    it("a failing database insert removes the stored file, the temp file and the new folder", async () => {
      const mod = await import("@/lib/db/files");
      vi.spyOn(mod, "insertFileRow").mockRejectedValue(new Error("disk full"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await upload("a.pdf");
      expect(r.status).toBe(500);
      expect(rows()).toHaveLength(0);
      expect(allEntries()).toEqual([]); // not even the empty folder
    });
    it("a failed upload keeps earlier files of the same application and its folder", async () => {
      await upload("keep.pdf");
      const mod = await import("@/lib/db/files");
      vi.spyOn(mod, "insertFileRow").mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await upload("second.pdf");
      expect(r.status).toBe(500);
      expect(allEntries().sort()).toEqual(["Acme_Robotics_2026-11", "Acme_Robotics_2026-11/01-20261108-keep.pdf"]);
      expect(rows()).toHaveLength(1);
    });
    it("a failing stream leaves nothing behind", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const bad = { name: "a.pdf", stream: () => new ReadableStream({ start: (c) => c.error(new Error("read failed")) }) };
      const r = await storeUploadedFile({ applicationId: appId, file: bad, label: "CV", uploadDate: DATE });
      expect(r).toMatchObject({ ok: false, kind: "error" });
      expect(rows()).toHaveLength(0);
      expect(allEntries()).toEqual([]);
    });
  });
});

describe("placing the file", () => {
  it("the temp name is gone before the file is made read-only (Windows would clear the attribute when removing it later)", async () => {
    const seen: string[][] = [];
    fsHooks.onChmod = (p, m) => { if (m === 0o444) seen.push(readdirSync(join(p, ".."))); };
    expect((await upload("CV.pdf")).status).toBe(201);
    expect(seen).toEqual([["01-20261108-CV.pdf"]]);
  });
  it("falls back to a copy when the drive has no hard links: same name, content, hash and read-only mode", async () => {
    fsHooks.link = () => Promise.reject(Object.assign(new Error("not supported"), { code: "ENOTSUP" }));
    const content = Buffer.from("no links here");
    const r = await upload("CV.pdf", content);
    expect(r.status).toBe(201);
    const out = (await r.json()).files[0];
    expect(out).toMatchObject({ storedName: "01-20261108-CV.pdf", sha256: sha(content), sizeBytes: content.length });
    const disk = join(root, out.relativePath);
    expect(readFileSync(disk)).toEqual(content);
    if (readOnly) expect(statSync(disk).mode & 0o777).toBe(0o444);
    expect(readdirSync(join(root, "Acme_Robotics_2026-11"))).toEqual(["01-20261108-CV.pdf"]);
  });
  it("the copy fallback never overwrites: a taken name moves to the next seq", async () => {
    await upload("CV.pdf", "first");
    fsHooks.link = () => Promise.reject(Object.assign(new Error("no links"), { code: "EPERM" }));
    const folder = join(root, "Acme_Robotics_2026-11");
    writeFileSync(join(folder, "02-20261108-CV.pdf"), "stray");
    expect((await (await upload("CV.pdf", "second")).json()).files[0].storedName).toBe("03-20261108-CV.pdf");
    expect(readFileSync(join(folder, "02-20261108-CV.pdf"), "utf8")).toBe("stray");
  });
  it("another link error is not hidden by a copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fsHooks.link = () => Promise.reject(Object.assign(new Error("io"), { code: "EIO" }));
    expect((await upload("CV.pdf")).status).toBe(500);
    expect(rows()).toHaveLength(0);
    expect(allEntries()).toEqual([]);
  });
});

describe("serialising and the counter race", () => {
  it("concurrent FIRST uploads for one application create exactly one folder", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map((i) => storeUploadedFile({ applicationId: appId, file: new File([`c${i}`], "CV.pdf"), label: "CV", uploadDate: DATE })));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(readdirSync(root)).toEqual(["Acme_Robotics_2026-11"]);
    expect(rows().map((r) => r.seq).sort()).toEqual([1, 2, 3, 4]);
  });
  it("concurrent uploads of the same base/date/ext never share a seq (no per-application queue: EEXIST and unique-index retry)", async () => {
    await upload("CV.pdf", "first"); // the folder exists, so only the counter is raced
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => storeFileUnlocked({ applicationId: appId, file: new File([`c${i}`], "CV.pdf"), label: "CV", uploadDate: DATE })));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rows().map((r) => r.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(readdirSync(join(root, "Acme_Robotics_2026-11")).sort()).toEqual(rows().map((r) => r.storedName).sort());
    for (const r of rows()) expect(sha(readFileSync(join(root, r.relativePath)))).toBe(r.sha256);
  });
  it("a file already on disk without a row (manual drop or crash) is skipped, not overwritten", async () => {
    await upload("CV.pdf", "first");
    const folder = join(root, "Acme_Robotics_2026-11");
    writeFileSync(join(folder, "02-20261108-CV.pdf"), "stray");
    const r = await upload("CV.pdf", "second");
    expect((await r.json()).files[0].storedName).toBe("03-20261108-CV.pdf");
    expect(readFileSync(join(folder, "02-20261108-CV.pdf"), "utf8")).toBe("stray");
    expect(existsSync(join(folder, "03-20261108-CV.pdf"))).toBe(true);
  });
  it("the unique index alone (a counter row exists, its file does not) moves to the next seq and removes the file it just placed", async () => {
    await upload("CV.pdf", "first");
    rmSync(join(root, rows()[0].relativePath)); // so the link succeeds and only the insert collides
    const mod = await import("@/lib/db/files");
    const real = mod.getCounterEntries;
    let first = true;
    vi.spyOn(mod, "getCounterEntries").mockImplementation(async (id) => { if (first) { first = false; return []; } return real(id); }); // stale read
    const r = await upload("CV.pdf", "second");
    expect((await r.json()).files[0].storedName).toBe("02-20261108-CV.pdf");
    expect(rows().map((x) => x.seq).sort()).toEqual([1, 2]);
    expect(readdirSync(join(root, "Acme_Robotics_2026-11"))).toEqual(["02-20261108-CV.pdf"]);
  });
});
