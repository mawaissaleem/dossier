// Server-only. ONE in-process lock for the jobs that must not overlap: a backup, a restore and a change of the files root (8.2, 8.4, 8.10).
// Uploads are counted too: a move waits for none to be running and, while it runs, new uploads are refused (they would write into the folder
// being emptied). Kept on globalThis because server actions and route handlers can be bundled as separate module instances.
// shortcut: per server process, fine for one local user; a second server on the same data is not serialised, upgrade then.
export type Job = "backup" | "restore" | "move";
type State = { job: Job | null; uploads: number };
const g = globalThis as { __dossierLock?: State };
const state = (g.__dossierLock ??= { job: null, uploads: 0 });

export const MOVING_MESSAGE = "The files folder is being changed. Try again when it is done.";

// Takes the lock for `job`, or says why not (the message is ready to show).
export function tryLock(job: Job): { ok: true; release: () => void } | { ok: false; error: string } {
  if (state.job) {
    if (state.job === "move") return { ok: false, error: job === "move" ? "The files folder is already being changed. Try again when it is done." : MOVING_MESSAGE };
    if (job === "move") return { ok: false, error: "A backup or restore is running. Try again when it is done." };
    return { ok: false, error: job === "backup" ? "A backup is already running." : "A backup or restore is already running." };
  }
  if (job === "move" && state.uploads > 0) return { ok: false, error: "An upload is in progress. Try again when it is done." };
  state.job = job;
  return { ok: true, release: () => { if (state.job === job) state.job = null; } };
}

export const lockedBy = (): Job | null => state.job;

// An upload registers itself; refused while a move holds the lock.
export function beginUpload(): (() => void) | null {
  if (state.job === "move") return null;
  state.uploads++;
  let ended = false;
  return () => { if (!ended) { ended = true; state.uploads--; } };
}
