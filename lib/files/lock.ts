// Server-only. ONE in-process lock for the jobs that must not overlap: a backup, a restore and a change of the files root (8.2, 8.4, 8.10).
// Uploads and file deletes register as "writes": they touch the database and the files folder in two steps with I/O in between, so a move
// or restore landing in that gap would leave the second step working on the wrong folder or the restored data. While a move or restore runs
// new writes are refused, and neither starts while a write is running. A backup does not block writes (it copies a consistent database
// and whatever is on disk; a file that changes meanwhile is flagged on restore, see lib/files/restore.ts).
// Kept on globalThis because server actions and route handlers can be bundled as separate module instances.
// shortcut: per server process, fine for one local user; a second server on the same data is not serialised, upgrade then.
export type Job = "backup" | "restore" | "move";
type State = { job: Job | null; writes: number };
const g = globalThis as { __dossierLock?: State };
const state = (g.__dossierLock ??= { job: null, writes: 0 });

export const MOVING_MESSAGE = "The files folder is being changed. Try again when it is done.";
const RESTORING_MESSAGE = "A restore is running. Try again when it is done.";

// Takes the lock for `job`, or says why not (the message is ready to show).
export function tryLock(job: Job): { ok: true; release: () => void } | { ok: false; error: string } {
  if (state.job) {
    if (state.job === "move") return { ok: false, error: job === "move" ? "The files folder is already being changed. Try again when it is done." : MOVING_MESSAGE };
    if (job === "move") return { ok: false, error: "A backup or restore is running. Try again when it is done." };
    return { ok: false, error: job === "backup" ? "A backup is already running." : "A backup or restore is already running." };
  }
  if (job !== "backup" && state.writes > 0) return { ok: false, error: "An upload or delete is in progress. Try again when it is done." };
  state.job = job;
  return { ok: true, release: () => { if (state.job === job) state.job = null; } };
}

export const lockedBy = (): Job | null => state.job;

// An upload or delete registers itself; refused while a move or restore holds the lock. Call `end` when done.
export function beginWrite(): { ok: true; end: () => void } | { ok: false; error: string } {
  if (state.job === "move") return { ok: false, error: MOVING_MESSAGE };
  if (state.job === "restore") return { ok: false, error: RESTORING_MESSAGE };
  state.writes++;
  let ended = false;
  return { ok: true, end: () => { if (!ended) { ended = true; state.writes--; } } };
}
