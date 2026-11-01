# dossier

## Development

- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run lint`: ESLint
- `npx tsc --noEmit`: type check
- `npm test`: run Vitest once (temporary databases only; `npm run test:watch` to watch)
- `npm run db:migrate`: apply `./drizzle` migrations to `DATABASE_PATH`
- `npm run db:seed`: seed the Job and PhD tracks (idempotent)
- `npm run db:generate`: generate a migration after editing `lib/db/schema.ts`
