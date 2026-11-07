import { describe, expect, it } from "vitest";
import { isLocalHost, isSameOrigin } from "@/lib/local-request";
import { parseUploadFields } from "@/lib/upload-form";

const h = (o: Record<string, string>) => new Headers(o);

describe("isLocalHost", () => {
  it("accepts localhost, 127.0.0.1 and [::1] with or without a port, any case", () => {
    for (const host of ["localhost", "LOCALHOST:3000", "127.0.0.1:4000", "[::1]:3000"]) expect(isLocalHost(h({ host }))).toBe(true);
  });
  it("refuses other hosts and a missing Host", () => {
    for (const host of ["evil.example", "localhost.evil.example:3000", "127.0.0.1.evil.example"]) expect(isLocalHost(h({ host }))).toBe(false);
    expect(isLocalHost(h({}))).toBe(false);
  });
});

describe("isSameOrigin", () => {
  const host = "localhost:3000";
  it("accepts an Origin with the same host and port", () => {
    expect(isSameOrigin(h({ host, origin: "http://localhost:3000" }))).toBe(true);
  });
  it("refuses another origin, port, scheme-less or null Origin", () => {
    for (const origin of ["http://evil.example", "http://localhost:3001", "http://127.0.0.1:3000", "null", "localhost:3000", "ftp://localhost:3000"])
      expect(isSameOrigin(h({ host, origin }))).toBe(false);
  });
  it("without Origin needs Sec-Fetch-Site: same-origin", () => {
    expect(isSameOrigin(h({ host, "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(h({ host, "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(h({ host }))).toBe(false);
  });
  it("a cross-site Origin is refused even if Sec-Fetch-Site claims same-origin", () => {
    expect(isSameOrigin(h({ host, origin: "http://evil.example", "sec-fetch-site": "same-origin" }))).toBe(false);
  });
});

describe("parseUploadFields", () => {
  const today = "2026-11-08";
  it("defaults a missing or blank date to today and trims the label", () => {
    expect(parseUploadFields(" CV ", null, today)).toEqual({ ok: true, fields: { label: "CV", uploadDate: today } });
    expect(parseUploadFields("CV", "  ", today)).toEqual({ ok: true, fields: { label: "CV", uploadDate: today } });
    expect(parseUploadFields("CV", "2026-02-28", today)).toEqual({ ok: true, fields: { label: "CV", uploadDate: "2026-02-28" } });
  });
  it("rejects a missing, blank, long or multi-line label", () => {
    for (const l of [null, "", "  ", "a".repeat(61), "a\nb", 5]) expect(parseUploadFields(l, null, today)).toMatchObject({ ok: false, errors: { label: expect.any(String) } });
  });
  it("rejects a bad date", () => {
    for (const d of ["2026-02-30", "08/11/2026", "2026-1-1", " 2026-11-08", 20261108]) expect(parseUploadFields("CV", d, today)).toMatchObject({ ok: false, errors: { uploadDate: expect.any(String) } });
  });
});
