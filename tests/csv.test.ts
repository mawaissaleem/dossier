import { describe, expect, it } from "vitest";
import { exportFilename, toCsv, trackCsv } from "@/lib/csv";

const body = (s: string) => s.replace(/^﻿/, "");

describe("toCsv", () => {
  it("starts with a BOM, uses CRLF and ends the last line with CRLF", () => {
    const s = toCsv([["a", "b"], ["c", "d"]]);
    expect(s.charCodeAt(0)).toBe(0xfeff);
    expect(body(s)).toBe("a,b\r\nc,d\r\n");
  });
  it("quotes commas, quotes, CR and LF and doubles quotes", () => {
    expect(body(toCsv([["a,b", 'say "hi"', "l1\nl2", "l1\r\nl2", "x\ry"]]))).toBe('"a,b","say ""hi""","l1\nl2","l1\r\nl2","x\ry"\r\n');
  });
  it("leaves blanks empty and keeps unicode", () => {
    expect(body(toCsv([[null, "Zürich", "日本"]]))).toBe(",Zürich,日本\r\n");
  });
  it("prefixes a string that starts with = + - @ tab or CR with an apostrophe", () => {
    for (const s of ["=SUM(A1)", "+1", "-5", "@x", "\tx", "\rx"]) expect(body(toCsv([[s]])).replace(/"/g, "")).toBe(`'${s}\r\n`);
    expect(body(toCsv([["a=b", "'=x", " =x"]]))).toBe("a=b,'=x, =x\r\n");
  });
  it("writes numbers plain and never prefixes them", () => {
    expect(body(toCsv([[-5, 3.5, 0, 1e21]]))).toBe("-5,3.5,0,1e+21\r\n");
  });
});

describe("trackCsv", () => {
  const cols = [
    { id: 1, name: "Status", type: "single_select", options: [{ id: 10, label: "Applied" }, { id: 11, label: "=Offer" }] },
    { id: 2, name: "Done", type: "checkbox", options: [] },
    { id: 3, name: "Deadline", type: "date", options: [] },
    { id: 4, name: "Score", type: "number", options: [] },
  ];
  it("writes Title, the columns in order, then Archived, with labels and Yes/No", () => {
    const s = trackCsv(cols, [
      { title: "Acme, Inc", archived: false, values: { 1: 10, 2: true, 3: "2026-11-11", 4: -2 } },
      { title: "Zürich", archived: true, values: { 1: 11, 2: false, 3: null, 4: null } },
      { title: "Gone", archived: false, values: { 1: 99 } },
    ]);
    expect(body(s)).toBe(
      "Title,Status,Done,Deadline,Score,Archived\r\n" +
        '"Acme, Inc",Applied,Yes,2026-11-11,-2,No\r\n' +
        "Zürich,'=Offer,No,,,Yes\r\n" +
        "Gone,,,,,No\r\n",
    );
  });
  it("guards a column name and a title too", () => {
    expect(body(trackCsv([{ id: 1, name: "=x", type: "text", options: [] }], [{ title: "@t", archived: false, values: { 1: "-1" } }]))).toBe(
      "Title,'=x,Archived\r\n'@t,'-1,No\r\n",
    );
  });
});

describe("exportFilename", () => {
  it("is dossier-<track>-YYYYMMDD.csv", () => {
    expect(exportFilename("Job", new Date(2026, 10, 11))).toBe("dossier-job-20261111.csv");
    expect(exportFilename("PhD / Zürich 2", new Date(2026, 0, 5))).toBe("dossier-phd-zürich-2-20260105.csv");
    expect(exportFilename("///", new Date(2026, 0, 5))).toBe("dossier-track-20260105.csv");
  });
});
