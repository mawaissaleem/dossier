// Pure: palette tokens (stored in column_options.color, same set as scripts/seed.ts) to Tailwind chip classes.
// Full static strings, so Tailwind's scanner keeps them. The colours are theme tokens (--chip-<token> and
// --chip-<token>-foreground in app/globals.css), so each theme supplies its own AA-checked pair.
export const CHIP_CLASSES: Record<string, string> = {
  red: "bg-chip-red text-chip-red-foreground",
  orange: "bg-chip-orange text-chip-orange-foreground",
  amber: "bg-chip-amber text-chip-amber-foreground",
  green: "bg-chip-green text-chip-green-foreground",
  teal: "bg-chip-teal text-chip-teal-foreground",
  blue: "bg-chip-blue text-chip-blue-foreground",
  purple: "bg-chip-purple text-chip-purple-foreground",
  gray: "bg-chip-gray text-chip-gray-foreground",
};

// Unknown token (hasOwn, so "constructor" is unknown too) falls back to gray.
export const chipClasses = (token: string): string => (Object.hasOwn(CHIP_CLASSES, token) ? CHIP_CLASSES[token] : CHIP_CLASSES.gray);

export const PALETTE: string[] = Object.keys(CHIP_CLASSES);
export const isPaletteToken = (t: unknown): t is string => typeof t === "string" && Object.hasOwn(CHIP_CLASSES, t);

// Default colour for a new option: the first palette token no option of the column uses yet, else gray.
export const nextColor = (used: string[]): string => PALETTE.find((t) => !used.includes(t)) ?? "gray";
