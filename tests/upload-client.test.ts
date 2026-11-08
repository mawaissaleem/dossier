import { describe, expect, it } from "vitest";
import { chooseLabel, CUSTOM_LABEL, describeResponse, duplicateMessage, formatBytes, sizeError } from "@/lib/upload-client";
import { DEFAULT_FILE_LABELS, MAX_UPLOAD_BYTES } from "@/lib/upload-form";

describe("chooseLabel", () => {
  it("uses the picked label, or the trimmed custom text", () => {
    expect(chooseLabel("CV", "ignored")).toBe("CV");
    expect(chooseLabel(CUSTOM_LABEL, "  Portfolio ")).toBe("Portfolio");
    expect(chooseLabel(CUSTOM_LABEL, "")).toBe("");
    expect(DEFAULT_FILE_LABELS).not.toContain(CUSTOM_LABEL);
    expect(chooseLabel("", "x")).toBe("x");
  });
});

describe("sizeError", () => {
  it("allows up to the limit and refuses above it", () => {
    expect(sizeError([])).toBeNull();
    expect(sizeError([MAX_UPLOAD_BYTES])).toBeNull();
    expect(sizeError([MAX_UPLOAD_BYTES - 1, 2])).toMatch(/max 50 MB/);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("describeResponse", () => {
  const f = (storedName: string) => ({ storedName, id: 1 });
  it("201 lists the stored names", () => {
    expect(describeResponse(201, { files: [f("01-20261108-CV.pdf"), f("01-20261108-CV.docx")] })).toMatchObject({ ok: true, message: null, stored: ["01-20261108-CV.pdf", "01-20261108-CV.docx"] });
  });
  it("200 (every file a duplicate) is ok with warnings and nothing stored; 201 can carry both", () => {
    const d = { originalName: "CV copy.pdf", storedName: "01-20261108-CV.pdf", id: 1 };
    expect(describeResponse(200, { files: [], duplicates: [d] })).toMatchObject({ ok: true, message: null, stored: [], duplicates: [{ originalName: "CV copy.pdf", storedName: "01-20261108-CV.pdf" }] });
    expect(describeResponse(201, { files: [f("02-x.pdf")], duplicates: [d] })).toMatchObject({ ok: true, stored: ["02-x.pdf"], duplicates: [expect.objectContaining({ storedName: "01-20261108-CV.pdf" })] });
    expect(describeResponse(500, { error: "x", duplicates: [d, null, { originalName: 3 }] }).duplicates).toHaveLength(1);
    expect(describeResponse(201, { files: [] }).duplicates).toEqual([]);
    expect(duplicateMessage(d)).toBe("Identical file already uploaded: CV copy.pdf matches 01-20261108-CV.pdf");
  });
  it("400 with errors maps onto the fields", () => {
    const r = describeResponse(400, { errors: { label: "Choose a label.", uploadDate: "Use a real date as YYYY-MM-DD.", files: "Choose at least one file." } });
    expect(r).toMatchObject({ ok: false, message: null, fieldErrors: { label: "Choose a label.", uploadDate: "Use a real date as YYYY-MM-DD.", files: "Choose at least one file." } });
  });
  it("400 with unreadable errors or no errors gives a general message", () => {
    expect(describeResponse(400, { errors: {} }).message).toMatch(/Check the fields/);
    expect(describeResponse(400, { error: "x" }).message).toMatch(/not understood/);
  });
  it("409 points to Settings, 413 to the limit, 403 and 404 are clear", () => {
    expect(describeResponse(409, { error: "The files folder cannot be read. Check it in Settings." })).toMatchObject({ ok: false, settingsLink: true, message: "The files folder cannot be read. Check it in Settings." });
    expect(describeResponse(409, undefined).message).toMatch(/not set or cannot be used/);
    expect(describeResponse(413, {}).message).toBe("Too large (max 50 MB per upload). Nothing was saved.");
    expect(describeResponse(403, {}).message).toMatch(/Refused/);
    expect(describeResponse(404, {}).message).toMatch(/no longer exists/);
  });
  it("500 keeps the names stored before the failure and the server's reason", () => {
    const r = describeResponse(500, { error: "Disk full.", files: [f("01-20261108-a.pdf")] });
    expect(r).toMatchObject({ ok: false, stored: ["01-20261108-a.pdf"], settingsLink: false });
    expect(r.message).toContain("Disk full.");
    expect(r.message).toContain("kept");
  });
  it("copes with a missing or odd body", () => {
    expect(describeResponse(500, undefined)).toMatchObject({ ok: false, stored: [] });
    expect(describeResponse(201, "x")).toMatchObject({ ok: true, stored: [] });
    expect(describeResponse(201, { files: [null, 3, {}] }).stored).toEqual([]);
  });
});
