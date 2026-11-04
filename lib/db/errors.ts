// Server-only. The SQLite code is on the error itself (drizzle-orm 0.45) or on `cause` (newer drizzle wraps the driver error).
const code = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;

export const isUniqueViolation = (e: unknown): boolean => code(e) === "SQLITE_CONSTRAINT_UNIQUE";
export const isForeignKeyViolation = (e: unknown): boolean => code(e) === "SQLITE_CONSTRAINT_FOREIGNKEY";
