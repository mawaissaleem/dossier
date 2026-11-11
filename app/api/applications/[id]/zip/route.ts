import { basename } from "node:path/posix";
import { NextRequest, NextResponse } from "next/server";
import { getApplicationFolder, getFolderNameData } from "@/lib/db/files";
import { contentDisposition } from "@/lib/file-serve";
import { applicationZipStream, planApplicationZip, type ZipProblem } from "@/lib/files/zip";
import { isCrossSiteFetch, isLocalHost } from "@/lib/local-request";
import { applicationZipName } from "@/lib/zip-name";

// GET /api/applications/:id/zip  downloads every live file of the application as one zip (lib/files/zip.ts: flat, stored names, streamed).
// 200 application/zip attachment <folder>-files-YYYYMMDD.zip (no-store, nosniff, CORP same-origin); 403 not local or Sec-Fetch-Site
// cross-site/same-site; 404 unknown or another user's application, or no files; 409 files folder unset, or no file could be read (never an
// empty zip), or (without ?anyway=1) a small HTML page listing the changed, missing, unreadable or too-large files with a "Download anyway"
// link when at least one file would be included (?anyway=1: changed files are included as they are on disk, the others skipped). Hashes are
// verified and recorded before anything is sent and again as each file is added (FR-5.5).
const NO_STORE = { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const WHAT = { changed: "changed since upload", missing: "missing from the files folder", unreadable: "could not be read", "too-large": "larger than any upload, so it is not read" };
const problemPage = (id: number, problems: ZipProblem[], anyway: boolean) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Files need attention</title><h1>Some files need attention</h1>` +
      `<p>The zip was not made because these files are not as they were uploaded:</p>` +
      `<ul>${problems.map((p) => `<li>${esc(p.storedName)}: ${WHAT[p.kind]}</li>`).join("")}</ul>` +
      (anyway
        ? `<p><a href="/api/applications/${id}/zip?anyway=1">Download anyway</a> (changed files are included as they are on disk now; missing, unreadable and too-large files are left out)</p>`
        : `<p>None of the files can be read, so there is nothing to zip.</p>`),
    { status: 409, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } }, // no sandbox: a sandboxed page's link click would reach the guard as cross-site
  );

export async function GET(request: NextRequest, ctx: RouteContext<"/api/applications/[id]/zip">) {
  if (!isLocalHost(request.headers) || isCrossSiteFetch(request.headers)) return json("Local use only.", 403);
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  const app = Number.isSafeInteger(id) ? await getFolderNameData(id) : null;
  if (!app) return json("Application not found.", 404);
  const anyway = request.nextUrl.searchParams.get("anyway") === "1";
  const plan = await planApplicationZip(id);
  if (!plan.ok) return json(plan.error, plan.kind === "none" ? 404 : 409);
  if (plan.problems.length > 0 && !anyway) return problemPage(id, plan.problems, plan.includable > 0);
  if (plan.includable === 0) return json("None of this application's files could be read; there is nothing to zip.", 409);
  const folder = await getApplicationFolder(id);
  return new Response(applicationZipStream(plan.names), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition("attachment", applicationZipName(folder ? basename(folder) : app.title, new Date())),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
