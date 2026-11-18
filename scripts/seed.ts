// Optional: adds the Job and PhD tracks from the same templates as the Add track dialog (lib/track-templates.ts). Idempotent: does nothing if the user already has a track.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  // Dynamic imports so DATABASE_PATH is loaded before the db module reads it.
  const db = (await import("../lib/db/client")).getDb();
  const { settings, tracks } = await import("../lib/db/schema");
  const { getUserId } = await import("../lib/db/user");
  const { insertTrackFromTemplate } = await import("../lib/db/tracks");
  const { TEMPLATES } = await import("../lib/track-templates");
  const { PALETTE } = await import("../lib/colors");
  const { DEFAULT_FILE_LABELS } = await import("../lib/upload-form");
  const { eq } = await import("drizzle-orm");

  const userId = getUserId();
  const seeded = db.transaction((tx) => {
    if (tx.select({ id: tracks.id }).from(tracks).where(eq(tracks.userId, userId)).limit(1).all().length) return false;
    tx.insert(settings)
      .values({ userId, key: "file_labels", value: JSON.stringify(DEFAULT_FILE_LABELS) })
      .run();
    // The same code as the Add track dialog; colours in palette order, which is what defaultTrackColor picks for the first two tracks.
    [TEMPLATES.job, TEMPLATES.phd].forEach((t, i) => insertTrackFromTemplate(t.defaultName, t, PALETTE[i]));
    return true;
  });

  console.log(seeded ? "Seeded Job and PhD tracks." : "already seeded");
}

main();
