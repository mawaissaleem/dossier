// Seeds the Job and PhD starter tracks (FR-1.1). Idempotent: does nothing if the user already has a track.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
type ColumnType = import("../lib/db/schema").ColumnType;

type Opt = [label: string, bufferDays?: number];
type Col = { name: string; type: ColumnType; isStatus?: boolean; options?: Opt[]; defaultOption?: string };

const COLORS = ["red", "orange", "amber", "green", "teal", "blue", "purple", "gray"]; // palette tokens, distinct within a column

const priority: Col = { name: "Priority", type: "single_select", options: [["Priority", 3], ["Good-to-have", 0]] };
const effort: Col = { name: "Effort", type: "single_select", options: [["Heavy", 2], ["Medium", 1], ["Light", 0]] };
const status = (...labels: string[]): Col => ({
  name: "Status", type: "single_select", isStatus: true, options: labels.map((l) => [l]), defaultOption: "To apply",
});
const text = (name: string): Col => ({ name, type: "text" });
const date = (name: string): Col => ({ name, type: "date" });
const link = (name: string): Col => ({ name, type: "link" });

const TRACKS = [
  {
    name: "Job",
    expectedLabels: ["CV", "Cover letter"],
    columns: [
      status("To apply", "Applied", "Interview", "Offer", "Rejected", "Withdrawn"),
      text("Company"), text("Role"), priority, effort,
      date("Deadline"), date("Follow-up date"), link("Link"), text("Location"),
    ],
  },
  {
    name: "PhD",
    expectedLabels: ["CV", "SOP", "Transcript"],
    columns: [
      status("To apply", "In progress", "Submitted", "Interview", "Offer", "Rejected", "Withdrawn"),
      text("University"), text("Program"), text("Supervisor"), priority, effort,
      date("Deadline"), date("Follow-up date"), link("Link"), text("Funding"),
    ],
  },
];

async function main() {
  // Dynamic imports so DATABASE_PATH is loaded before the db module reads it.
  const db = (await import("../lib/db/client")).getDb();
  const { columnOptions, columns, settings, tracks } = await import("../lib/db/schema");
  const { getUserId } = await import("../lib/db/user");
  const { DEFAULT_FILE_LABELS } = await import("../lib/upload-form");
  const { eq } = await import("drizzle-orm");

  const userId = getUserId();
  const seeded = db.transaction((tx) => {
    if (tx.select({ id: tracks.id }).from(tracks).where(eq(tracks.userId, userId)).limit(1).all().length) return false;

    tx.insert(settings).values({ userId, key: "file_labels", value: JSON.stringify(DEFAULT_FILE_LABELS) }).run();

    TRACKS.forEach((t, trackPos) => {
      const track = tx.insert(tracks).values({ userId, name: t.name, position: trackPos }).returning().get();
      tx.insert(settings)
        .values({ userId, key: `track.${track.id}.expected_labels`, value: JSON.stringify(t.expectedLabels) })
        .run();

      t.columns.forEach((c, colPos) => {
        const col = tx
          .insert(columns)
          .values({ userId, trackId: track.id, name: c.name, type: c.type, position: colPos, isStatus: !!c.isStatus })
          .returning()
          .get();
        const ids = new Map<string, number>();
        c.options?.forEach(([label, bufferDays], i) => {
          const o = tx
            .insert(columnOptions)
            .values({ userId, columnId: col.id, label, color: COLORS[i % COLORS.length], position: i, bufferDays })
            .returning()
            .get();
          ids.set(label, o.id);
        });
        if (c.defaultOption) {
          tx.update(columns).set({ defaultValue: String(ids.get(c.defaultOption)) }).where(eq(columns.id, col.id)).run();
        }
      });
    });
    return true;
  });

  console.log(seeded ? "Seeded Job and PhD tracks." : "already seeded");
}

main();
