import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addColumn } from "@/app/actions/columns";
import { moveFilesRoot, repointFilesRoot, fetchMoveImpact } from "@/app/actions/settings";
import { addSubmission } from "@/app/actions/submissions";
import { GET as getZip } from "@/app/api/applications/[id]/zip/route";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as getSearch } from "@/app/api/search/route";
import { createApplication, getApplicationDetail, listApplicationRows } from "@/lib/db/applications";
import { getDb } from "@/lib/db/client";
import { addNote } from "@/lib/db/notes";
import { currentCounts } from "@/lib/db/restore";
import { files, tracks } from "@/lib/db/schema";
import { searchApplications } from "@/lib/db/search";
import { getFilesRoot, setFilesRoot } from "@/lib/db/settings";
import { setBackupDestination } from "@/lib/db/backup";
import { listSubmissions } from "@/lib/db/submissions";
import { KNOWN_COMPANIES } from "@/lib/fake-data";
import { createBackup } from "@/lib/files/backup";
import { checkBackup, restoreFromBackup } from "@/lib/files/restore";
import { verifyStoredFile } from "@/lib/files/open";
import { storeUploadedFile } from "@/lib/files/store";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";
import { readZip } from "./helpers/zip";
import { runTsx } from "./helpers/tsx";

vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

// Task 12.4: the parts of AT-12, AT-13 and AT-14 that no single earlier test encodes as the SRS words them. Everything lives in OS temp dirs.
//   AT-12: the data path (500 fake applications, search by company, the latest submission). The 30 s wall time is a manual measurement.
//   AT-13: the wipe is an empty install (no tracks, no columns), not just deleted applications, so columns and cell values must come from the zip.
//   AT-14: both ways in a row (Move, then Re-point), then Open and the per-application zip after each.
const SLOW = 60_000; // each test spawns tsx scripts and writes files; the default 5 s is too tight on a loaded machine
let work: string;
let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
  work = mkdtempSync(join(tmpdir(), "dossier-at12-"));
});
afterEach(() => {
  dropTestDb();
  rmSync(work, { recursive: true, force: true });
});

const sub = (name: string) => {
  const p = join(work, name);
  mkdirSync(p);
  return p;
};
const jobTrack = () =>
  db
    .select()
    .from(tracks)
    .all()
    .find((t) => t.name === "Job")!.id;
async function store(applicationId: number, name: string, content: string, uploadDate = "2026-11-08", label = "CV") {
  const r = await storeUploadedFile({ applicationId, file: new File([content], name), label, uploadDate });
  if (!r.ok || !("file" in r)) throw new Error(JSON.stringify(r));
  return r.file;
}
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const asReq = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });

describe("AT-12: search a company name with 500 applications loaded", () => {
  it(
    "the right application is found and its latest submission is what the page lists first",
    async () => {
      runSeed();
      runTsx(["scripts/seed-fake.ts", "--count", "500"], {
        env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH! },
        stdio: "pipe",
      }); // the same script the manual run uses
      expect(currentCounts().applications).toBe(500);
      await setFilesRoot(sub("root"));

      const started = performance.now();
      const hits = await searchApplications("Hooli Cloud");
      const searchMs = performance.now() - started; // only the search is timed: the file writes and route calls below depend on disk and machine load
      expect(hits).toHaveLength(1); // exactly one Job application at that company
      const target = hits[0];
      expect(target).toMatchObject({ track: { name: "Job" }, matched: { kind: "title" } });
      expect(target.title).toMatch(/^Hooli Cloud/);

      // two submissions, the newer one on a different file: "latest" must be the newer
      const cv = await store(target.id, "CV.pdf", "cv bytes");
      const letter = await store(target.id, "Letter.pdf", "letter bytes", "2026-11-09", "Cover letter");
      expect(await addSubmission(target.id, [cv.id], "2026-11-08", null, null)).toEqual({ ok: true });
      expect(await addSubmission(target.id, [letter.id], "2026-11-10", "second", null)).toEqual({ ok: true });

      // what the palette does (GET /api/search), then what the application page reads
      const body = await (
        await getSearch(
          new NextRequest("http://localhost:3000/api/search?q=Hooli%20Cloud", { headers: { host: "localhost:3000" } }),
        )
      ).json();
      expect(body.results.map((r: { id: number }) => r.id)).toEqual([target.id]);
      const detail = await getApplicationDetail(target.id);
      expect(detail?.title).toBe(target.title);
      const subs = await listSubmissions(target.id);
      expect(subs.map((s) => s.date)).toEqual(["2026-11-10", "2026-11-08"]); // newest first, so subs[0] is the "Latest" item
      expect(subs[0].files.map((f) => f.originalName)).toEqual(["Letter.pdf"]);
      expect(
        (
          await getFile(asReq(`/api/files/${subs[0].files[0].id}`), {
            params: Promise.resolve({ id: String(subs[0].files[0].id) }),
          } as never)
        ).status,
      ).toBe(200); // one more click: the file opens
      expect(searchMs).toBeLessThan(5000); // the SRS bound is 30 s for a person; this only guards the code path of the search itself
    },
    SLOW,
  );

  it(
    "every known company name finds its own application first, and a spread of others are found too",
    async () => {
      runSeed();
      runTsx(["scripts/seed-fake.ts", "--count", "500"], {
        env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH! },
        stdio: "pipe",
      });
      for (const company of KNOWN_COMPANIES) {
        const hits = await searchApplications(company);
        expect(hits[0].title.startsWith(company), company).toBe(true);
      }
      const trackId = jobTrack();
      const rows = await listApplicationRows(trackId);
      for (const row of rows.filter((_, i) => i % 25 === 0)) {
        const company = row.title.split(" - ")[0];
        expect(
          (await searchApplications(company)).some((h) => h.id === row.id),
          company,
        ).toBe(true);
      }
    },
    SLOW,
  );
});

describe("AT-13: back up, delete the app data, restore (into an empty install)", () => {
  it(
    "applications, columns, cell values, files, submissions and notes come back identical",
    async () => {
      runSeed();
      runTsx(["scripts/seed-fake.ts", "--count", "40"], {
        env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH! },
        stdio: "pipe",
      });
      const root = sub("root");
      const dest = sub("backups");
      await setFilesRoot(root);
      await setBackupDestination(dest);
      const trackId = jobTrack();
      expect((await addColumn(trackId, "Contact person", "text")).ok).toBe(true); // a column of the user's own
      const a = await createApplication({ title: "Acme Robotics", trackId, values: [] });
      if (!a.ok) throw new Error(a.error);
      const cv = await store(a.id, "CV.pdf", "cv bytes");
      await store(a.id, "Letter.txt", "dear sirs", "2026-11-08", "Cover letter");
      expect(await addSubmission(a.id, [cv.id], "2026-11-08", "sent", null)).toEqual({ ok: true });
      expect((await addNote(a.id, "called them")).ok).toBe(true);

      const TABLES = [
        "tracks",
        "columns",
        "column_options",
        "applications",
        "cell_values",
        "files",
        "submissions",
        "submission_files",
        "notes",
        "activity_events",
      ];
      const tables = () =>
        Object.fromEntries(TABLES.map((t) => [t, getDb().$client.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
      const hashes = (dir: string, prefix = ""): Record<string, string> =>
        Object.fromEntries(
          readdirSync(dir).flatMap((n) => {
            const p = join(dir, n);
            return statSync(p).isDirectory() ? Object.entries(hashes(p, `${prefix}${n}/`)) : [[prefix + n, sha(p)]];
          }),
        );
      const before = { tables: tables(), files: hashes(root), counts: currentCounts() };
      expect(before.counts).toMatchObject({ applications: 41, files: 2, submissions: 1, notes: 1 });
      expect(before.tables.cell_values.length).toBeGreaterThan(100);

      const made = await createBackup(dest, new Date(2026, 10, 9, 10, 0));
      if (!made.ok) throw new Error(made.error);
      const zip = join(work, "keep.zip");
      writeFileSync(zip, readFileSync(made.path));

      // delete the app data: the database file and the files folder are gone, and the install starts empty (migrated, not seeded)
      db = useTestDb();
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root);
      await setFilesRoot(root);
      await setBackupDestination(dest);
      expect(currentCounts()).toMatchObject({ applications: 0, columns: 0, files: 0, submissions: 0, notes: 0 });
      expect(readdirSync(root)).toEqual([]);

      const info = await checkBackup(zip);
      expect(info).toMatchObject({ ok: true, info: { counts: before.counts, fileCount: 2, changed: [], missing: [] } });
      const r = await restoreFromBackup(zip, {
        createdAt: new Date(2026, 10, 9, 10, 0).toISOString(),
        counts: currentCounts(),
      });
      expect(r).toMatchObject({ ok: true, counts: before.counts, warnings: [] });

      const after = { tables: tables(), files: hashes(root), counts: currentCounts() };
      expect(after.counts).toEqual(before.counts);
      expect(after.tables).toEqual(before.tables); // columns, options, cell values, files rows (hashes), submissions, notes: row for row
      expect(after.files).toEqual(before.files); // the same paths with the same bytes
      for (const row of getDb().$client.prepare("SELECT relative_path, sha256 FROM files").all() as {
        relative_path: string;
        sha256: string;
      }[]) {
        expect(sha(join(root, row.relative_path))).toBe(row.sha256);
      }
      expect((await verifyStoredFile(cv.id)).ok).toBe(true);
    },
    SLOW,
  );
});

describe("AT-14: change the files root, Move then Re-point; existing files stay accessible", () => {
  it(
    "after each way every file opens (hash checked) and the per-application zip holds the same bytes",
    async () => {
      runSeed();
      const root = sub("root");
      await setFilesRoot(root);
      const trackId = jobTrack();
      const mk = async (title: string) => {
        const r = await createApplication({ title, trackId, values: [] });
        if (!r.ok) throw new Error(r.error);
        return r.id;
      };
      const [appA, appB] = [await mk("Acme"), await mk("Beta")];
      const f = [
        await store(appA, "CV.pdf", "cv one"),
        await store(appA, "CV.pdf", "cv two, corrected"),
        await store(appB, "Portfolio.pdf", "portfolio"),
      ];
      const expected = new Map(f.map((x, i) => [x.id, ["cv one", "cv two, corrected", "portfolio"][i]]));

      async function expectAccessible(where: string) {
        for (const x of f) {
          const res = await getFile(asReq(`/api/files/${x.id}`), {
            params: Promise.resolve({ id: String(x.id) }),
          } as never);
          expect(res.status, `${where}: open ${x.storedName}`).toBe(200);
          expect(Buffer.from(await res.arrayBuffer()).toString(), where).toBe(expected.get(x.id));
          expect(
            db
              .select()
              .from(files)
              .all()
              .find((r) => r.id === x.id)!.integrity,
            where,
          ).toBe("ok");
        }
        for (const [app, names] of [
          [appA, f.slice(0, 2)],
          [appB, f.slice(2)],
        ] as const) {
          const z = await getZip(asReq(`/api/applications/${app}/zip`), {
            params: Promise.resolve({ id: String(app) }),
          } as never);
          expect(z.status, `${where}: zip ${app}`).toBe(200);
          const out = join(work, `z-${app}-${Math.random().toString(36).slice(2)}.zip`);
          writeFileSync(out, Buffer.from(await z.arrayBuffer()));
          const got = readZip(out);
          expect([...got.keys()].sort(), where).toEqual(names.map((x) => x.storedName).sort());
          for (const x of names) expect(got.get(x.storedName)!.toString(), where).toBe(expected.get(x.id));
        }
      }
      await expectAccessible("before");

      // way 1: Move
      const moved = sub("moved");
      const impact = await fetchMoveImpact();
      if (!impact.ok) throw new Error(impact.error);
      expect(await moveFilesRoot(moved, { fileCount: impact.fileCount, totalBytes: impact.totalBytes })).toMatchObject({
        ok: true,
        path: moved,
        moved: 3,
      });
      expect(await getFilesRoot()).toBe(moved);
      await expectAccessible("after Move");

      // way 2: the user moves the folder by hand, then Re-point
      const byHand = join(work, "by-hand");
      renameSync(moved, byHand);
      expect(await repointFilesRoot(byHand)).toMatchObject({ ok: true, path: byHand, checked: 3 });
      expect(await getFilesRoot()).toBe(byHand);
      await expectAccessible("after Re-point");
    },
    SLOW,
  );
});
