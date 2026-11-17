# Architecture decisions

The stack is the one in `CLAUDE.md`. This file records decisions that deviate from, or settle, something in the SRS or the build plan. If it conflicts with the stack in `CLAUDE.md`, this file wins.

## Decisions

### 2026-11-17: tracks are created, renamed, recoloured and deleted in the app (task TRK.1)
User ruling. It overrides **FR-1.1** ("the app ships with two starter tracks, Job and PhD") and **FR-1.10** ("creating new custom tracks beyond the two starters is deferred to v2"). The SRS and build plan are not edited.
- A new database has **no tracks**. Job and PhD are **templates** the user adds (`lib/track-templates.ts`, pure), together with a **Blank** template (one Status column). A template can be added more than once under different names.
- One code path builds a track: `insertTrackFromTemplate` in `lib/db/tracks.ts`. The Add track dialog and `npm run db:seed` (now optional, idempotent, creates Job and PhD) both use it, so the templates are exactly what the seed always created.
- Custom tracks are still data: columns and values stay in `columns` / `cell_values`; the only schema change is `tracks.color` (nullable palette token; null on tracks made before TRK.1, shown with a colour derived from the id).
- Deleting a track removes its rows (ON DELETE CASCADE) and its `track.<id>.*` settings in one transaction, after a confirm that states the counts and needs the typed name. Files on disk are **not** deleted.
- Existing databases are untouched: no migration renames or removes Job or PhD.
