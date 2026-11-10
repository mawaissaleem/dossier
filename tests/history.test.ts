import { describe, expect, it } from "vitest";
import { buildHistory, eventLine, formatYmd } from "@/lib/history";
import { parseActivityDetails, type ActivityDetails } from "@/lib/activity";

const at = (s: string) => new Date(s);
const NOW = at("2026-11-10T12:00:00Z");
const status: ActivityDetails = { kind: "status_changed", columnId: 1, fromOptionId: 1, fromLabel: "To apply", toOptionId: 2, toLabel: "Applied" };
const upload: ActivityDetails = { kind: "file_uploaded", fileId: 1, originalName: "CV.pdf", storedName: "01-20261110-CV.pdf", label: "CV", uploadDate: "2026-11-10" };
const sub: ActivityDetails = { kind: "submission_created", submissionId: 1, date: "2026-11-10", fileCount: 2, fileNames: ["a", "b"] };
const ev = (id: number, kind: string, occurredAt: Date, details: ActivityDetails) => ({ id, kind, occurredAt, details });

describe("eventLine", () => {
  it("reads each kind from the snapshot", () => {
    expect(eventLine("status_changed", status)).toBe("Status: To apply → Applied");
    expect(eventLine("file_uploaded", upload)).toBe("Uploaded CV.pdf as 01-20261110-CV.pdf (CV)");
    expect(eventLine("submission_created", sub)).toBe("Submission dated 10 Nov 2026 with 2 files");
  });
  it("handles blank statuses and file counts", () => {
    expect(eventLine("status_changed", { ...status, fromLabel: null, toLabel: null })).toBe("Status: (blank) → (blank)");
    expect(eventLine("submission_created", { ...sub, fileCount: 1 })).toBe("Submission dated 10 Nov 2026 with 1 file");
    expect(eventLine("submission_created", { ...sub, fileCount: 0 })).toBe("Submission dated 10 Nov 2026 with no files");
  });
  it("falls back to a neutral line for garbled details or an unknown kind", () => {
    const bad = parseActivityDetails("status_changed", "{");
    expect(eventLine("status_changed", bad)).toBe("Status changed");
    expect(eventLine("file_uploaded", bad)).toBe("File uploaded");
    expect(eventLine("submission_created", bad)).toBe("Submission recorded");
    expect(eventLine("future_kind", bad)).toBe("Activity recorded");
  });
  it("keeps a date that is not YYYY-MM-DD as stored", () => {
    expect(formatYmd("2026-13-01")).toBe("2026-13-01");
    expect(formatYmd("soon")).toBe("soon");
    expect(formatYmd("2026-01-05")).toBe("5 Jan 2026");
  });
});

describe("buildHistory", () => {
  it("merges notes and events newest first with typed items", () => {
    const h = buildHistory(
      [{ id: 1, body: "first", createdAt: at("2026-11-08T10:00:00Z") }, { id: 2, body: "third", createdAt: at("2026-11-10T10:00:00Z") }],
      [ev(1, "status_changed", at("2026-11-09T10:00:00Z"), status), ev(2, "file_uploaded", at("2026-11-10T11:00:00Z"), upload)],
      NOW,
    );
    expect(h.map((i) => [i.type, i.text])).toEqual([
      ["upload", "Uploaded CV.pdf as 01-20261110-CV.pdf (CV)"], ["note", "third"], ["status", "Status: To apply → Applied"], ["note", "first"],
    ]);
  });
  it("breaks ties by notes first, then the higher id, whatever the input order", () => {
    const t = at("2026-11-10T10:00:00Z");
    const notes = [{ id: 1, body: "n1", createdAt: t }, { id: 2, body: "n2", createdAt: t }];
    const events = [ev(1, "status_changed", t, status), ev(2, "file_uploaded", t, upload)];
    const want = ["note-2", "note-1", "event-2", "event-1"];
    expect(buildHistory(notes, events, NOW).map((i) => i.key)).toEqual(want);
    expect(buildHistory([...notes].reverse(), [...events].reverse(), NOW).map((i) => i.key)).toEqual(want);
  });
  it("marks only events dated after now as future, and sorts them first", () => {
    const h = buildHistory(
      [{ id: 1, body: "n", createdAt: at("2026-11-10T11:00:00Z") }],
      [ev(1, "submission_created", at("2026-11-12T22:59:59.999Z"), { ...sub, date: "2026-11-12" }), ev(2, "status_changed", NOW, status)],
      NOW,
    );
    expect(h.map((i) => [i.key, i.future])).toEqual([["event-1", true], ["event-2", false], ["note-1", false]]);
  });
  it("is empty for nothing", () => expect(buildHistory([], [], NOW)).toEqual([]));
});
