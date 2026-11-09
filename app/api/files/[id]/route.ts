import { NextRequest, NextResponse } from "next/server";
import { fileHeaders } from "@/lib/file-serve";
import { openStoredFile } from "@/lib/files/open";
import { isCrossSiteFetch, isLocalHost } from "@/lib/local-request";

// GET /api/files/:id  streams a stored file (the Open action, opened in a new tab). The id selects a database row (of this user); the path
// on disk comes from that row through resolveInRoot, never from the request. 200 file bytes (headers in lib/file-serve.ts: inline only for
// pdf/png/jpg/gif/webp/txt, everything else a download; always nosniff and no-store; CSP sandbox + default-src 'none', minus sandbox for pdf); 403 not local or Sec-Fetch-Site cross-site/same-site (every response, errors too, carries Cross-Origin-Resource-Policy: same-origin); 404 unknown id, refused stored
// path, or the file is missing on disk (the message says which); 409 files folder unset; 500 unreadable.
const NO_STORE = { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  if (!isLocalHost(request.headers) || isCrossSiteFetch(request.headers)) return json("Local use only.", 403);
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id)) return json("File not found.", 404);
  const r = await openStoredFile(id);
  if (!r.ok) return json(r.error, r.kind === "setup" ? 409 : r.kind === "error" ? 500 : 404);
  return new Response(r.stream, { headers: fileHeaders(r.storedName, r.sizeBytes) });
}
