import { NextRequest, NextResponse } from "next/server";
import { fileHeaders } from "@/lib/file-serve";
import { verifyStoredFile } from "@/lib/files/open";
import { isCrossSiteFetch, isLocalHost } from "@/lib/local-request";

// GET /api/files/:id  streams a stored file (the Open action, opened in a new tab). The id selects a database row (of this user); the path
// on disk comes from that row through resolveInRoot, never from the request. 200 file bytes (headers in lib/file-serve.ts: inline only for
// pdf/png/jpg/gif/webp/txt, everything else a download; always nosniff and no-store; CSP sandbox + default-src 'none', minus sandbox for pdf); 403 not local or Sec-Fetch-Site cross-site/same-site (every response, errors too, carries Cross-Origin-Resource-Policy: same-origin); 404 unknown id, refused stored
// path, or the file is missing on disk (the message says which); 410 the file was deleted on purpose (8.8); 409 files folder unset; 500 unreadable.
// Hash check (8.6): the bytes are hashed before anything is sent. A changed file gets 409 and a small HTML page (it opens in a new tab) with the
// stored name, the expected and found hash prefixes and an "Open anyway" link (?anyway=1), which serves the bytes with the same headers.
const NO_STORE = { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const changedPage = (id: number, name: string, expected: string, found: string | null) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>File changed</title><h1>This file has changed</h1>` +
      `<p>${esc(name)} is not the file that was uploaded: it was edited, replaced or damaged outside Dossier since then.</p>` +
      `<p>Expected hash ${expected.slice(0, 12)}, found ${found ? found.slice(0, 12) : "none (the file is larger than any upload)"}.</p>` +
      `<p><a href="/api/files/${id}?anyway=1">Open anyway</a> (the changed file, as it is on disk now)</p>`,
    { status: 409, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } }, // no sandbox: a sandboxed page's link click would reach the guard as cross-site
  );

export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  if (!isLocalHost(request.headers) || isCrossSiteFetch(request.headers)) return json("Local use only.", 403);
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id)) return json("File not found.", 404);
  const r = await verifyStoredFile(id);
  if (!r.ok) return json(r.error, r.kind === "setup" ? 409 : r.kind === "error" ? 500 : r.kind === "deleted" ? 410 : 404);
  if (r.integrity === "mismatch") {
    if (request.nextUrl.searchParams.get("anyway") !== "1") return changedPage(id, r.storedName, r.expected, r.found);
    if (!r.bytes) return json("This file is far larger than anything Dossier stored and is not opened.", 409);
  }
  return new Response(new Uint8Array(r.bytes!), { headers: fileHeaders(r.storedName, r.bytes!.length) });
}
