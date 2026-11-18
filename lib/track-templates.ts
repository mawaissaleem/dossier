// Pure: the track templates (Job, PhD, Blank) and the name and colour rules for tracks. No DB or UI imports.
// The Job and PhD definitions are what `npm run db:seed` always created (FR-1.1); a user ruling of 2026-11-17 made them templates the user adds.
import type { ColumnType } from "./db/schema";
import { PALETTE, isPaletteToken } from "./colors";

type Opt = [label: string, bufferDays?: number];
export type TemplateColumn = {
  name: string;
  type: ColumnType;
  isStatus?: boolean;
  options?: Opt[];
  defaultOption?: string;
};
export type TrackTemplate = {
  label: string; // the choice in the Add track dialog
  hint: string;
  defaultName: string; // prefilled name; "" for Blank
  expectedLabels: string[];
  submitted: string[]; // status labels
  wins: string[];
  stillToDo?: string[]; // only set when given (the Job and PhD defaults are computed in code, as they always were)
  columns: TemplateColumn[];
};

const priority: TemplateColumn = {
  name: "Priority",
  type: "single_select",
  options: [
    ["Priority", 3],
    ["Good-to-have", 0],
  ],
};
const effort: TemplateColumn = {
  name: "Effort",
  type: "single_select",
  options: [
    ["Heavy", 2],
    ["Medium", 1],
    ["Light", 0],
  ],
};
const status = (...labels: string[]): TemplateColumn => ({
  name: "Status",
  type: "single_select",
  isStatus: true,
  options: labels.map((l) => [l]),
  defaultOption: "To apply",
});
const text = (name: string): TemplateColumn => ({ name, type: "text" });
const date = (name: string): TemplateColumn => ({ name, type: "date" });
const link = (name: string): TemplateColumn => ({ name, type: "link" });

export const TEMPLATE_IDS = ["job", "phd", "blank"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const isTemplateId = (v: unknown): v is TemplateId =>
  typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);

export const TEMPLATES: Record<TemplateId, TrackTemplate> = {
  job: {
    label: "Job template",
    hint: "Company, role, priority, effort, deadlines; CV and cover letter expected.",
    defaultName: "Job",
    expectedLabels: ["CV", "Cover letter"],
    submitted: ["Applied"],
    wins: ["Interview", "Offer"],
    columns: [
      status("To apply", "Applied", "Interview", "Offer", "Rejected", "Withdrawn"),
      text("Company"),
      text("Role"),
      priority,
      effort,
      date("Deadline"),
      date("Follow-up date"),
      link("Link"),
      text("Location"),
    ],
  },
  phd: {
    label: "PhD template",
    hint: "University, program, supervisor, funding; CV, SOP and transcript expected.",
    defaultName: "PhD",
    expectedLabels: ["CV", "SOP", "Transcript"],
    submitted: ["Submitted"],
    wins: ["Interview", "Offer"],
    columns: [
      status("To apply", "In progress", "Submitted", "Interview", "Offer", "Rejected", "Withdrawn"),
      text("University"),
      text("Program"),
      text("Supervisor"),
      priority,
      effort,
      date("Deadline"),
      date("Follow-up date"),
      link("Link"),
      text("Funding"),
    ],
  },
  blank: {
    label: "Blank (custom)",
    hint: "Just a Status column. Add your own columns afterwards.",
    defaultName: "",
    expectedLabels: [],
    submitted: ["Applied"],
    wins: ["Interview", "Offer"],
    stillToDo: ["To apply"],
    columns: [status("To apply", "Applied", "Interview", "Offer", "Rejected")],
  },
};

export const MAX_TRACK_NAME = 60;

// Trimmed name, 1 to 60 characters, not used by another track of the user (case-insensitive). `others` = the names of the user's other tracks.
export function checkTrackName(
  name: unknown,
  others: readonly string[],
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "Name is required." };
  const n = name.trim();
  if (n.length > MAX_TRACK_NAME) return { ok: false, error: `Name must be at most ${MAX_TRACK_NAME} characters.` };
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase()))
    return { ok: false, error: "A track with this name already exists." };
  return { ok: true, name: n };
}

export function checkTrackColor(color: unknown): { ok: true; color: string } | { ok: false; error: string } {
  return isPaletteToken(color) ? { ok: true, color } : { ok: false, error: "Choose a valid colour." };
}

// A new track's colour: the first palette token no other track uses, else the least used. Tracks saved before colours existed (null) get one from their id.
export function defaultTrackColor(used: readonly (string | null)[]): string {
  const taken = used.filter((c): c is string => c !== null);
  return (
    PALETTE.find((t) => !taken.includes(t)) ??
    PALETTE.reduce((a, b) => (taken.filter((c) => c === b).length < taken.filter((c) => c === a).length ? b : a))
  );
}

export const colorOrFallback = (color: string | null, id: number): string =>
  isPaletteToken(color) ? color : PALETTE[id % PALETTE.length];
