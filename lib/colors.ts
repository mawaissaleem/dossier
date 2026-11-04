// Pure: palette tokens (stored in column_options.color, same set as scripts/seed.ts) to Tailwind chip classes.
// Full static strings, so Tailwind's scanner keeps them. Light mode; each pair is background + dark text.
export const CHIP_CLASSES: Record<string, string> = {
  red: "bg-red-100 text-red-900",
  orange: "bg-orange-100 text-orange-900",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-green-100 text-green-900",
  teal: "bg-teal-100 text-teal-900",
  blue: "bg-blue-100 text-blue-900",
  purple: "bg-purple-100 text-purple-900",
  gray: "bg-gray-200 text-gray-900",
};

// Unknown token (hasOwn, so "constructor" is unknown too) falls back to gray.
export const chipClasses = (token: string): string => (Object.hasOwn(CHIP_CLASSES, token) ? CHIP_CLASSES[token] : CHIP_CLASSES.gray);

export const PALETTE: string[] = Object.keys(CHIP_CLASSES);
export const isPaletteToken = (t: unknown): t is string => typeof t === "string" && Object.hasOwn(CHIP_CLASSES, t);

// Default colour for a new option: the first palette token no option of the column uses yet, else gray.
export const nextColor = (used: string[]): string => PALETTE.find((t) => !used.includes(t)) ?? "gray";
