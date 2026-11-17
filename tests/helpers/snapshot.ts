import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { columnOptions, columns, settings, tracks } from "@/lib/db/schema";

// Everything a track template writes, with ids replaced by names and labels so two databases compare equal. Settings of other keys (file_labels) are left out.
export function trackSnapshot() {
  const db = getDb();
  const opts = db.select().from(columnOptions).orderBy(asc(columnOptions.position)).all();
  const label = (id: number) => opts.find((o) => o.id === id)?.label;
  const sets = db.select().from(settings).all();
  return db.select().from(tracks).orderBy(asc(tracks.position)).all().map((t) => {
    const setting = (name: string) => { const r = sets.find((s) => s.key === `track.${t.id}.${name}`); return r ? JSON.parse(r.value) : undefined; };
    const ids = (name: string) => (setting(name) as number[] | undefined)?.map(label);
    return {
      name: t.name,
      position: t.position,
      expectedLabels: setting("expected_labels"),
      submitted: ids("submitted_statuses"),
      wins: ids("win_statuses"),
      stillToDo: ids("still_to_do"),
      columns: db.select().from(columns).orderBy(asc(columns.position)).all().filter((c) => c.trackId === t.id).map((c) => ({
        name: c.name, type: c.type, position: c.position, isStatus: c.isStatus, hidden: c.hidden,
        default: c.defaultValue === null ? null : label(Number(c.defaultValue)),
        options: opts.filter((o) => o.columnId === c.id).map((o) => ({ label: o.label, color: o.color, position: o.position, bufferDays: o.bufferDays })),
      })),
    };
  });
}
