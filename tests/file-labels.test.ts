import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFileLabels, setSetting } from "@/lib/db/settings";
import { DEFAULT_FILE_LABELS } from "@/lib/upload-form";
import { dropTestDb, runSeed, useTestDb } from "./helpers/db";

beforeEach(() => void useTestDb());
afterEach(dropTestDb);

describe("getFileLabels", () => {
  it("falls back to the default list when unset", async () => {
    expect(await getFileLabels()).toEqual(DEFAULT_FILE_LABELS);
  });
  it("reads the list the seed stores", async () => {
    runSeed();
    expect(await getFileLabels()).toEqual(["CV", "Cover letter", "SOP", "Transcript", "Writing sample"]);
  });
  it("uses a stored list, dropping blank or non-string entries, and falls back when nothing usable is left", async () => {
    await setSetting("file_labels", ["CV", " ", 3, "Portfolio"]);
    expect(await getFileLabels()).toEqual(["CV", "Portfolio"]);
    await setSetting("file_labels", "nope");
    expect(await getFileLabels()).toEqual(DEFAULT_FILE_LABELS);
    await setSetting("file_labels", []);
    expect(await getFileLabels()).toEqual(DEFAULT_FILE_LABELS);
  });
});
