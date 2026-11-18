import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/colors";
import {
  MAX_TRACK_NAME,
  TEMPLATES,
  TEMPLATE_IDS,
  checkTrackColor,
  checkTrackName,
  colorOrFallback,
  defaultTrackColor,
  isTemplateId,
} from "@/lib/track-templates";

describe("checkTrackName", () => {
  it("trims and accepts 1 to 60 characters", () => {
    expect(checkTrackName("  Job – Europe ", [])).toEqual({ ok: true, name: "Job – Europe" });
    expect(checkTrackName("x".repeat(MAX_TRACK_NAME), [])).toMatchObject({ ok: true });
    expect(checkTrackName("x".repeat(MAX_TRACK_NAME + 1), [])).toMatchObject({ ok: false });
  });
  it("refuses blank and non-string names", () => {
    for (const bad of ["", "   ", undefined, null, 5])
      expect(checkTrackName(bad, [])).toMatchObject({ ok: false, error: "Name is required." });
  });
  it("refuses a name another track has, ignoring case and surrounding spaces", () => {
    expect(checkTrackName("job", ["Job", "PhD"])).toEqual({
      ok: false,
      error: "A track with this name already exists.",
    });
    expect(checkTrackName(" PHD ", ["Job", "PhD"])).toMatchObject({ ok: false });
    expect(checkTrackName("Job 2", ["Job"])).toMatchObject({ ok: true });
  });
});

describe("colours", () => {
  it("accepts palette tokens only", () => {
    expect(checkTrackColor("teal")).toEqual({ ok: true, color: "teal" });
    for (const bad of ["#fff", "pink", "", "constructor", null, 3])
      expect(checkTrackColor(bad)).toMatchObject({ ok: false });
  });
  it("defaults to the first colour nobody uses, then to the least used", () => {
    expect(defaultTrackColor([])).toBe(PALETTE[0]);
    expect(defaultTrackColor(["red", "orange", null])).toBe("amber");
    expect(defaultTrackColor([...PALETTE, "red"])).toBe("orange"); // all used, red twice: the first of the least used
  });
  it("gives a track without a stored colour one from its id, and keeps a stored one", () => {
    expect(PALETTE).toContain(colorOrFallback(null, 7));
    expect(colorOrFallback(null, 1)).not.toBe(colorOrFallback(null, 2));
    expect(colorOrFallback("blue", 1)).toBe("blue");
    expect(colorOrFallback("nope", 1)).toBe(PALETTE[1]);
  });
});

describe("templates", () => {
  it("has Job, PhD and Blank, and checks ids", () => {
    expect([...TEMPLATE_IDS]).toEqual(["job", "phd", "blank"]);
    expect(isTemplateId("phd")).toBe(true);
    expect(isTemplateId("constructor")).toBe(false);
    expect([TEMPLATES.job.defaultName, TEMPLATES.phd.defaultName, TEMPLATES.blank.defaultName]).toEqual([
      "Job",
      "PhD",
      "",
    ]);
  });
  it("every status label the settings name exists in the status column; exactly one status column", () => {
    for (const t of Object.values(TEMPLATES)) {
      const status = t.columns.filter((c) => c.isStatus);
      expect(status).toHaveLength(1);
      const labels = status[0].options!.map(([l]) => l);
      for (const l of [...t.submitted, ...t.wins, ...(t.stillToDo ?? []), status[0].defaultOption!])
        expect(labels).toContain(l);
    }
  });
  it("Blank is a lone Status column", () => {
    expect(TEMPLATES.blank.columns.map((c) => c.name)).toEqual(["Status"]);
    expect(TEMPLATES.blank.columns[0].options!.map(([l]) => l)).toEqual([
      "To apply",
      "Applied",
      "Interview",
      "Offer",
      "Rejected",
    ]);
  });
});
