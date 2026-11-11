import { describe, expect, it } from "vitest";
import { buildActivityDetails, type ActivityDetails, parseActivityDetails, submissionOccurredAt } from "@/lib/activity";

describe("activity details", () => {
  const status: ActivityDetails = { kind: "status_changed", columnId: 1, fromOptionId: null, fromLabel: null, toOptionId: 2, toLabel: "Applied" };
  const file: ActivityDetails = { kind: "file_uploaded", fileId: 3, originalName: "cv.docx", storedName: "01-20261105-cv.docx", label: "CV", uploadDate: "2026-11-05" };
  const sub: ActivityDetails = { kind: "submission_created", submissionId: 4, date: "2026-11-05", fileCount: 1, fileNames: ["a.docx"] };

  const del: ActivityDetails = { kind: "file_deleted", fileId: 3, originalName: "cv.docx", storedName: "01-20261105-cv.docx", label: "CV", submissionCount: 2,
    counter: { baseName: "cv", uploadDate: "2026-11-05", extension: "docx", seq: 1 } };

  it.each([status, file, sub, del])("round-trips $kind", (d) => {
    expect(parseActivityDetails(d.kind, buildActivityDetails(d))).toEqual(d);
  });

  it("file_deleted: the counter is optional (older events), but a bad one is refused", () => {
    const { counter, ...old } = del as Extract<ActivityDetails, { kind: "file_deleted" }>;
    expect(parseActivityDetails("file_deleted", JSON.stringify(old))).toStrictEqual(old);
    expect(parseActivityDetails("file_deleted", JSON.stringify({ ...old, counter: { ...counter, seq: "1" } }))).toEqual({ kind: "unknown" });
    expect(parseActivityDetails("file_deleted", JSON.stringify({ ...old, counter: null }))).toEqual({ kind: "unknown" });
  });

  it("falls back to unknown for garbled, mistyped or wrong-kind JSON and never throws", () => {
    for (const bad of ["", "{", "null", "[]", "5", '"x"', "{}", '{"columnId":"1"}']) {
      expect(parseActivityDetails("status_changed", bad)).toEqual({ kind: "unknown" });
    }
    expect(parseActivityDetails("file_uploaded", buildActivityDetails(status))).toEqual({ kind: "unknown" });
    expect(parseActivityDetails("nope", buildActivityDetails(status))).toEqual({ kind: "unknown" });
    expect(parseActivityDetails("submission_created", '{"submissionId":1,"date":"d","fileCount":1,"fileNames":[1]}')).toEqual({ kind: "unknown" });
  });

  it("refuses to build details that would not parse", () => {
    expect(() => buildActivityDetails({ ...sub, fileCount: 1.5 })).toThrow();
  });
});

describe("submissionOccurredAt", () => {
  const now = new Date(2026, 10, 10, 15, 30);
  it("is now for today's date", () => expect(submissionOccurredAt("2026-11-10", now)).toBe(now));
  it("is the end of that day for another date", () => {
    expect(submissionOccurredAt("2026-11-05", now)).toEqual(new Date(2026, 10, 5, 23, 59, 59, 999));
    expect(submissionOccurredAt("2026-11-05", now).getTime()).toBeLessThan(now.getTime());
  });
});
