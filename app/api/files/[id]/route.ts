import { NextRequest, NextResponse } from "next/server";
import { fileHeaders } from "@/lib/file-serve";
import { verifyStoredFile } from "@/lib/files/open";
import { databaseUpdateResponse } from "@/lib/db/migrations";
import { isCrossSiteFetch, isLocalHost } from "@/lib/local-request";
import { esc, problemPage, setupPage } from "@/lib/problem-page";

// GET /api/files/:id streams a stored file (the Open action, opened in a new tab). The id selects a database row (of
// this user); the path on disk comes from that row through resolveInRoot, never from the request. 200 file bytes
// (headers in lib/file-serve.ts: inline only for pdf/png/jpg/gif/webp/txt, everything else a download; always nosniff
// and no-store; CSP sandbox + default-src 'none', minus sandbox for pdf, plus frame-ancestors 'self' so only Dossier
// frames a file: the Preview dialog; ?download=1 sends it as an attachment); 403 not local or Sec-Fetch-Site
// cross-site/same-site (every response, errors too, carries Cross-Origin-Resource-Policy: same-origin); 404 unknown id
// or refused stored path (JSON), or the file is missing on disk (a themed page that says which, like 500 unreadable);
// 410 the file was deleted on purpose; 409 files folder unset or gone (a themed HTML page with a Settings link, like
// the changed page); 500 unreadable. Hash check: the bytes are hashed before anything is sent. A changed file gets 409
// and a small HTML page (it opens in a new tab) with the stored name, the expected and found hash prefixes and an "Open
// anyway" link (?anyway=1), which serves the bytes with the same headers.
const NO_STORE = { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

// `download`: the changed page was reached from the Download action (?download=1), so "Open anyway" keeps the download.
const changedPage = (
  id: number,
  applicationId: number,
  name: string,
  expected: string,
  found: string | null,
  download: boolean,
) =>
  problemPage(
    409,
    "This file has changed",
    `<p>${esc(name)} is not the file that was uploaded: it was edited, replaced or damaged outside Dossier since then.</p>` +
      `<p>Expected hash ${esc(expected.slice(0, 12))}, found ${found ? esc(found.slice(0, 12)) : "none (the file is larger than any upload)"}.</p>` +
      `<p><a href="/api/files/${id}?anyway=1${download ? "&download=1" : ""}">Open anyway</a> (the changed file, as it is on disk now)</p>`,
    applicationId,
    NO_STORE,
  );

export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  if (!isLocalHost(request.headers) || isCrossSiteFetch(request.headers)) return json("Local use only.", 403);
  const behind = databaseUpdateResponse(); // 503 while migrations are pending, instead of a "no such table" crash
  if (behind) return behind;
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id)) return json("File not found.", 404);
  const r = await verifyStoredFile(id);
  if (!r.ok && r.kind === "setup") return setupPage(r.error, r.applicationId!, NO_STORE);
  // A file gone from disk (404) or unreadable (500) gets a themed page too (it shows in the Preview frame and in a
  // tab); the other failures stay JSON.
  if (!r.ok && r.applicationId && (r.kind === "missing" || r.kind === "error"))
    return problemPage(
      r.kind === "missing" ? 404 : 500,
      r.kind === "missing" ? "This file is missing" : "This file could not be read",
      `<p>${esc(r.error)}</p>`,
      r.applicationId,
      NO_STORE,
    );
  if (!r.ok)
    return json(r.error, r.kind === "setup" ? 409 : r.kind === "error" ? 500 : r.kind === "deleted" ? 410 : 404);
  const download = request.nextUrl.searchParams.get("download") === "1";
  if (r.integrity === "mismatch") {
    if (request.nextUrl.searchParams.get("anyway") !== "1")
      return changedPage(id, r.applicationId, r.storedName, r.expected, r.found, download);
    if (!r.bytes) return json("This file is far larger than anything Dossier stored and is not opened.", 409);
  }
  return new Response(new Uint8Array(r.bytes!), { headers: fileHeaders(r.storedName, r.bytes!.length, download) });
}
