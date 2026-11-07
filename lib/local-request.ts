// Pure (no fs, no DB). Request checks shared by the local API routes.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The server binds to localhost; refusing other Host names also blocks DNS rebinding from a web page.
// Read the Host header, not request.nextUrl: behind next start the URL is built from the bind address and ignores a forged Host.
export function isLocalHost(headers: Headers): boolean {
  return LOCAL_HOSTS.has((headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase());
}

// CSRF guard for requests that change data: a cross-site page can POST a multipart form to localhost with a valid Host.
// Browsers always send Origin on such a POST; it must be this server's own origin (same host and port as Host).
// Without Origin, Sec-Fetch-Site must say same-origin. Anything else (curl without Origin, "null", other sites) is refused.
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin === null) return headers.get("sec-fetch-site") === "same-origin";
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host.toLowerCase() === (headers.get("host") ?? "").toLowerCase();
  } catch {
    return false;
  }
}
