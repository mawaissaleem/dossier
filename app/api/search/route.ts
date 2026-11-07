import { NextRequest, NextResponse } from "next/server";
import { searchApplications } from "@/lib/db/search";
import { parseSearchQuery } from "@/lib/search";

// GET /api/search?q=acme&limit=20 -> { results: SearchHit[] }.
// A Route Handler, not a server action: the Ctrl/Cmd+K box (4.7) fires a request per keystroke and must abort stale ones;
// server actions run one at a time and cannot be cancelled. Not cached: GET handlers are dynamic unless opted in, and this reads
// the request. Blank q = empty results; q over 200 characters = 400.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  // The server binds to localhost; refusing other Host names also blocks DNS rebinding from a web page.
  // The Host header, not request.nextUrl: behind next start the URL is built from the bind address and ignores a forged Host.
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return NextResponse.json({ error: "Local use only." }, { status: 403, headers: NO_STORE });
  const parsed = parseSearchQuery(request.nextUrl.searchParams.get("q"));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  const limit = request.nextUrl.searchParams.get("limit");
  const results = await searchApplications(parsed.query, { limit: limit === null ? undefined : Number(limit) });
  return NextResponse.json({ results }, { headers: NO_STORE });
}
