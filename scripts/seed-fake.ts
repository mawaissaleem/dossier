// Fills a scratch database with fake applications for performance and search work (task 4.4). Run `npm run db:seed` first.
//   npm run db:seed:fake -- [--count 500] [--mix Job=80,PhD=20] [--seed 1] [--base 2026-11-07] [--force]
// Deterministic: the same --seed and --base give the same data. NOT idempotent: every run adds another batch (same seed = same
// names again), so use a fresh database or a different --seed. Refuses the default real database (./data/dossier.db) without --force.
// Every column from listColumns gets data, hidden ones included (fine for a test dataset).
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import { CELL_FIELD, parseCell } from "../lib/cells"; // pure (type-only schema import), safe before DATABASE_PATH is loaded

loadEnvConfig(process.cwd());

const CHUNK = 200; // rows per INSERT: 200 rows (or 200 cell values) stays far below SQLite's bound-variable limit

async function main() {
  const { values } = parseArgs({ options: { count: { type: "string", default: "500" }, mix: { type: "string", default: "Job=80,PhD=20" }, seed: { type: "string", default: "1" }, base: { type: "string", default: "2026-11-07" }, force: { type: "boolean", default: false } } });
  const count = Number(values.count);
  const seed = Number(values.seed);
  if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error("--count must be a whole number from 1 to 100000.");
  if (!Number.isInteger(seed)) throw new Error("--seed must be a whole number.");
  const parsedBase = parseCell("date", values.base);
  if (!parsedBase.ok || typeof parsedBase.value !== "string") throw new Error("--base must be a real date as YYYY-MM-DD.");
  const base = parsedBase.value;
  const mix = values.mix!.split(",").map((p) => p.split("=")).map(([name, w]) => ({ name: name?.trim(), weight: Number(w) }));
  if (mix.some((m) => !m.name || !(m.weight > 0))) throw new Error('--mix must look like "Job=80,PhD=20" (track name = positive weight).');

  const target = resolve(process.env.DATABASE_PATH ?? "");
  if (!process.env.DATABASE_PATH) throw new Error("DATABASE_PATH is not set.");
  if (target === resolve("./data/dossier.db") && !values.force) {
    console.error(`Refusing to write fake data into ${target} (your real database). Point DATABASE_PATH at a scratch file, or pass --force.`);
    process.exit(1);
  }

  // Dynamic imports so DATABASE_PATH is loaded before the db module reads it.
  const { getDb } = await import("../lib/db/client");
  const { applications, cellValues, tracks } = await import("../lib/db/schema");
  const { listColumns } = await import("../lib/db/columns");
  const { getUserId } = await import("../lib/db/user");
  const { generateApplications } = await import("../lib/fake-data");
  const { mulberry32 } = await import("../lib/prng");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  const userId = getUserId();
  let existing;
  try {
    existing = db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.userId, userId)).all();
  } catch {
    throw new Error(`${target} has no tables yet. Run "npm run db:migrate" and "npm run db:seed" first.`);
  }
  const missing = mix.filter((m) => !existing.some((t) => t.name === m.name)).map((m) => m.name);
  if (missing.length) throw new Error(`No track named ${missing.join(", ")} in ${target}. Run "npm run db:seed" first, or change --mix (tracks here: ${existing.map((t) => t.name).join(", ") || "none"}).`);

  // Largest-share split by weight; the rounding remainder goes to the first track.
  const total = mix.reduce((s, m) => s + m.weight, 0);
  const counts = mix.map((m) => Math.floor((count * m.weight) / total));
  counts[0] += count - counts.reduce((s, n) => s + n, 0);

  const rng = mulberry32(seed);
  const started = performance.now();
  let blanks = 0, cells = 0;
  const added = await (async () => {
    const plan: { name: string; trackId: number; types: Map<number, import("../lib/db/schema").ColumnType>; rows: ReturnType<typeof generateApplications> }[] = [];
    for (const [i, m] of mix.entries()) {
      const track = existing.find((t) => t.name === m.name)!;
      const cols = await listColumns(track.id);
      plan.push({ name: m.name, trackId: track.id, types: new Map(cols.map((c) => [c.id, c.type])), rows: generateApplications(cols, counts[i], rng, base) });
    }
    return db.transaction((tx) => {
      for (const p of plan) {
        for (let at = 0; at < p.rows.length; at += CHUNK) {
          const chunk = p.rows.slice(at, at + CHUNK);
          const ids = tx.insert(applications).values(chunk.map((r) => ({ userId, trackId: p.trackId, title: r.title, archived: r.archived }))).returning({ id: applications.id, title: applications.title }).all();
          const cellRows = chunk.flatMap((r, k) => {
            if (ids[k]?.title !== r.title) throw new Error("Insert order mismatch."); // RETURNING order is relied on to pair ids with rows
            return Object.entries(r.cells).map(([cid, raw]) => {
              const type = p.types.get(Number(cid))!;
              const parsed = parseCell(type, raw); // the app's own validation: a value it would refuse is a bug in the generator
              if (!parsed.ok || parsed.value === null) throw new Error(`Generated an invalid ${type} value ${JSON.stringify(raw)}.`);
              return { userId, applicationId: ids[k].id, columnId: Number(cid), [CELL_FIELD[type]]: parsed.value };
            });
          });
          for (let c = 0; c < cellRows.length; c += CHUNK) tx.insert(cellValues).values(cellRows.slice(c, c + CHUNK)).run();
          cells += cellRows.length;
          blanks += chunk.length * p.types.size - cellRows.length;
        }
      }
      return plan.map((p) => `${p.rows.length} ${p.name}`);
    });
  })();
  const ms = Math.round(performance.now() - started);
  console.log(`Added ${count} fake applications (${added.join(", ")}) with ${cells} values and ${blanks} blank cells to ${target} in ${ms} ms. Run again and it adds another batch.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
