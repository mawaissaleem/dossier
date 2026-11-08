import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { saveExpectedLabels } from "@/app/actions/settings";
import { expectedLabelsKey, getExpectedLabels, setExpectedLabels } from "@/lib/db/track-settings";
import { setSetting } from "@/lib/db/settings";
import { settings, tracks } from "@/lib/db/schema";
import { checkExpectedLabels, labelMatches, MAX_EXPECTED_LABELS, missingLabels, resolveExpectedLabels, submissionWarnings } from "@/lib/expected-labels";
import { MAX_LABEL } from "@/lib/upload-form";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
beforeEach(() => { vi.mocked(refresh).mockClear(); db = useTestDb(); });
afterEach(dropTestDb);

const track = (name: string, userId = "local") => db.insert(tracks).values({ userId, name, position: 0 }).returning().get().id;

describe("matching rule", () => {
  it("equal after trim and case-fold, nothing fuzzier", () => {
    expect(labelMatches(" cv ", "CV")).toBe(true);
    expect(labelMatches("COVER LETTER", "Cover letter")).toBe(true);
    expect(labelMatches("Cover-letter", "Cover letter")).toBe(false);
    expect(labelMatches("CV2", "CV")).toBe(false);
  });
  it("missingLabels keeps the expected order and ignores extra file labels", () => {
    expect(missingLabels(["CV", "Cover letter", "SOP"], ["sop", "Writing sample"])).toEqual(["CV", "Cover letter"]);
    expect(missingLabels([], ["CV"])).toEqual([]);
    expect(missingLabels(["CV"], [])).toEqual(["CV"]);
  });
});

describe("validation", () => {
  it("trims, keeps order, allows an empty list", () => {
    expect(checkExpectedLabels([" CV ", "SOP"])).toEqual({ labels: ["CV", "SOP"] });
    expect(checkExpectedLabels([])).toEqual({ labels: [] });
  });
  it("refuses non-lists, non-strings, blanks, long or multi-line labels, case-insensitive duplicates and too many", () => {
    for (const bad of ["CV", null, [1], ["CV", ""], ["  "], ["a".repeat(MAX_LABEL + 1)], ["a\nb"], ["CV", " cv"]]) {
      expect(checkExpectedLabels(bad)).toHaveProperty("error");
    }
    expect(checkExpectedLabels(["a".repeat(MAX_LABEL)])).toHaveProperty("labels");
    const many = Array.from({ length: MAX_EXPECTED_LABELS + 1 }, (_, i) => `L${i}`);
    expect(checkExpectedLabels(many)).toHaveProperty("error");
    expect(checkExpectedLabels(many.slice(1))).toHaveProperty("labels");
  });
  it("resolveExpectedLabels reads defensively", () => {
    expect(resolveExpectedLabels(undefined)).toEqual([]);
    expect(resolveExpectedLabels("x")).toEqual([]);
    expect(resolveExpectedLabels([" CV", 3, "", "cv", "SOP"])).toEqual(["CV", "SOP"]);
  });
});

describe("data layer", () => {
  it("unset is empty; round-trips; empty list replaces", async () => {
    const t = track("Job");
    expect(await getExpectedLabels(t)).toEqual([]);
    expect(await setExpectedLabels(t, [" CV", "Cover letter"])).toEqual({ ok: true });
    expect(await getExpectedLabels(t)).toEqual(["CV", "Cover letter"]);
    expect(await setExpectedLabels(t, [])).toEqual({ ok: true });
    expect(await getExpectedLabels(t)).toEqual([]);
  });
  it("refuses bad input and tracks that are not the user's, saving nothing", async () => {
    const t = track("Job"), other = track("Theirs", "someone");
    expect(await setExpectedLabels(t, ["CV", "cv"])).toMatchObject({ ok: false });
    expect(await setExpectedLabels(other, ["CV"])).toMatchObject({ ok: false });
    expect(await setExpectedLabels(9999, ["CV"])).toMatchObject({ ok: false });
    expect(db.select().from(settings).where(eq(settings.key, expectedLabelsKey(t))).all()).toEqual([]);
  });
  it("treats a corrupt stored value as empty", async () => {
    const t = track("Job");
    await setSetting(expectedLabelsKey(t), "garbage");
    expect(await getExpectedLabels(t)).toEqual([]);
  });
  it("reads what the seed wrote", async () => {
    runSeed();
    const byName = Object.fromEntries(db.select().from(tracks).all().map((t) => [t.name, t.id]));
    expect(await getExpectedLabels(byName.Job)).toEqual(["CV", "Cover letter"]);
    expect(await getExpectedLabels(byName.PhD)).toEqual(["CV", "SOP", "Transcript"]);
  });
});

describe("saveExpectedLabels action", () => {
  it("saves and refreshes; returns the error and does not refresh on bad input", async () => {
    const t = track("Job");
    expect(await saveExpectedLabels(t, ["CV"])).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await saveExpectedLabels(t, ["CV", "CV"])).toMatchObject({ ok: false });
    expect(await saveExpectedLabels(t, "x" as unknown as string[])).toMatchObject({ ok: false });
    expect(await saveExpectedLabels(NaN, [])).toMatchObject({ ok: false });
    expect(await saveExpectedLabels(9999, [])).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await getExpectedLabels(t)).toEqual(["CV"]);
  });
});

describe("submissionWarnings (pure, FR-7.3)", () => {
  it("is empty when every expected label is covered, ignoring case and spaces", () => {
    expect(submissionWarnings(["cv ", "Cover letter", "Other"], ["CV", "Cover letter"])).toEqual([]);
  });
  it("warns once per expected label that no selected file covers, in the expected order", () => {
    expect(submissionWarnings(["Cover letter"], ["CV", "Cover letter", "Transcript"])).toEqual(["No file labelled CV", "No file labelled Transcript"]);
    expect(submissionWarnings(["CV", "CV"], ["CV", "Portfolio"])).toEqual(["No file labelled Portfolio"]);
  });
  it("warns about no files, plus every expected label, when nothing is selected", () => {
    expect(submissionWarnings([], ["CV"])).toEqual(["No files are selected.", "No file labelled CV"]);
    expect(submissionWarnings([], [])).toEqual(["No files are selected."]);
  });
  it("does not warn about labels when the track expects none", () => {
    expect(submissionWarnings(["Anything"], [])).toEqual([]);
  });
});
