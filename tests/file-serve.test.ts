import { describe, expect, it } from "vitest";
import { contentDisposition, fileHeaders } from "@/lib/file-serve";

describe("fileHeaders", () => {
  it.each([["pdf", "application/pdf"], ["PNG", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"], ["txt", "text/plain; charset=utf-8"]])("%s is shown inline", (ext, type) => {
    const h = fileHeaders(`01-20261108-a.${ext}`, 3);
    expect(h.get("content-type")).toBe(type);
    expect(h.get("content-disposition")).toMatch(/^inline;/);
  });
  it.each(["html", "htm", "svg", "xml", "js", "docx", "xhtml", "bin", ""])("%j is a download as octet-stream", (ext) => {
    const h = fileHeaders(ext ? `01-20261108-a.${ext}` : "01-20261108-a", 3);
    expect(h.get("content-type")).toBe("application/octet-stream");
    expect(h.get("content-disposition")).toMatch(/^attachment;/);
  });
  it("a name that only ends in a safe extension elsewhere is still judged by the last one", () => {
    expect(fileHeaders("a.pdf.html", 1).get("content-disposition")).toMatch(/^attachment;/);
    expect(fileHeaders(".pdf", 1).get("content-disposition")).toMatch(/^attachment;/);
  });
  it.each([["a.pdf", "default-src 'none'"], ["a.PDF", "default-src 'none'"], ["a.png", "sandbox; default-src 'none'"], ["a.jpg", "sandbox; default-src 'none'"],
    ["a.txt", "sandbox; default-src 'none'"], ["a.html", "sandbox; default-src 'none'"], ["a.svg", "sandbox; default-src 'none'"], ["a.pdf.html", "sandbox; default-src 'none'"]])(
    "%s gets CSP %j (only pdf drops sandbox, for Chrome's viewer)", (name, csp) => {
      expect(fileHeaders(name, 1).get("content-security-policy")).toBe(csp);
    });
  it("always sends the hardening headers and the size", () => {
    for (const name of ["a.pdf", "a.html"]) {
      const h = fileHeaders(name, 42);
      expect(h.get("x-content-type-options")).toBe("nosniff");
      expect(h.get("cache-control")).toBe("no-store");
      expect(h.get("content-length")).toBe("42");
    }
  });
});

describe("contentDisposition", () => {
  it("keeps a plain name as is", () => {
    expect(contentDisposition("inline", "01-20261108-My_CV.pdf")).toBe(`inline; filename="01-20261108-My_CV.pdf"; filename*=UTF-8''01-20261108-My_CV.pdf`);
  });
  it("cannot inject through quotes, CR/LF, semicolons or non-ASCII", () => {
    const v = contentDisposition("attachment", `a"b\r\nSet-Cookie: x=1;\\é'(*).html`);
    expect(v).not.toMatch(/[\r\n]/);
    expect(v.match(/"/g)).toHaveLength(2);
    expect(v).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''[A-Za-z0-9._%-]+$/);
    expect(v).toContain("%C3%A9");
    expect(v).toContain("%27%28%2A%29");
  });
  it("replaces non-ASCII with underscores and falls back to 'file' for an empty name", () => {
    expect(contentDisposition("inline", "é")).toBe(`inline; filename="_"; filename*=UTF-8''%C3%A9`);
    expect(contentDisposition("inline", "")).toBe(`inline; filename="file"; filename*=UTF-8''`);
  });
});
