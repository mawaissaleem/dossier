import { NextResponse, type NextRequest } from "next/server";
import { isLocalHost } from "@/lib/local-request";

// NFR-10: the one app-wide Host allow-list (DNS rebinding). A page on evil.example that re-points its name at 127.0.0.1 still sends
// "Host: evil.example", so it is refused here before any page, server action or API route runs. No matcher on purpose: it also covers
// _next/static and public/ (they hold no user data, but one rule with no exclusions has no gap to get wrong). The body has no user data.
// The API routes keep their own isLocalHost check as defence in depth.
export function proxy(request: NextRequest) {
  if (!isLocalHost(request.headers)) return new NextResponse("Forbidden: Dossier answers on localhost only.\n", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  return NextResponse.next();
}
