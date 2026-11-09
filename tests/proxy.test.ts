import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const req = (path: string, host: string | null, method = "GET") =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { method, headers: host === null ? {} : { host } }));

describe("proxy: app-wide Host allow-list (NFR-10)", () => {
  it("lets localhost, 127.0.0.1 and [::1] through on a page, a server-action-like POST and an API path", () => {
    for (const host of ["localhost:3000", "127.0.0.1:4010", "[::1]:3000", "LOCALHOST"]) {
      for (const [path, method] of [["/tracks/1", "GET"], ["/applications/1", "POST"], ["/api/search?q=a", "GET"]]) {
        const res = req(path, host, method);
        expect(res.status, `${host} ${method} ${path}`).toBe(200);
        expect(res.headers.get("x-middleware-next")).toBe("1"); // NextResponse.next(): carry on to the route
      }
    }
  });

  it("answers 403 plain text, with no user data, to a forged Host on a page, a POST and an API path", async () => {
    for (const host of ["evil.example", "evil.example:3000", "localhost.evil.example", "127.0.0.1.evil.example:3000", ""]) {
      for (const [path, method] of [["/tracks/1", "GET"], ["/applications/1", "POST"], ["/api/files/1", "GET"], ["/api/search?q=acme", "GET"]]) {
        const res = req(path, host, method);
        expect(res.status, `${host} ${method} ${path}`).toBe(403);
        expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(res.headers.get("x-middleware-next")).toBeNull();
        expect(await res.text()).toBe("Forbidden: Dossier answers on localhost only.\n");
      }
    }
  });

  it("refuses a request with no Host header", () => {
    expect(req("/", null).status).toBe(403);
  });
});
