import { NextRequest, NextResponse } from "next/server";
import { exportFilename, trackCsv } from "@/lib/csv";
import { getTrackExport } from "@/lib/db/export";
import { contentDisposition } from "@/lib/file-serve";
import { isCrossSiteFetch, isLocalHost } from "@/lib/local-request";

// GET /api/tracks/:id/export  downloads the track's table as CSV (lib/csv.ts has the format and the formula guard). It is every
// application of the track, archived ones too, every column (hidden too), newest first: the table's current filters and sort are NOT applied.
// 200 CSV attachment (no-store, nosniff); 403 not local or Sec-Fetch-Site cross-site/same-site (it returns the user's data, so another page
// must not be able to read it); 404 unknown or another user's track.
const NO_STORE = { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(request: NextRequest, ctx: RouteContext<"/api/tracks/[id]/export">) {
  if (!isLocalHost(request.headers) || isCrossSiteFetch(request.headers)) return json("Local use only.", 403);
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  const data = Number.isSafeInteger(id) ? await getTrackExport(id) : null;
  if (!data) return json("Track not found.", 404);
  return new Response(trackCsv(data.columns, data.rows), {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", exportFilename(data.trackName, new Date())),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
