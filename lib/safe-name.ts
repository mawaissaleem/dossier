// Pure (no fs, no DB). The one file/folder-name sanitiser (FR-6.6), used by the folder rule (5.4) and the filename rule (5.5).
// Replaces <>:"/\|? * and control characters, turns whitespace into "_", collapses repeats, trims leading/trailing dots, spaces and
// underscores, and makes Windows device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9 and the superscript COM¹-³, LPT¹-³, with or without extension) safe by appending "_"
// to the part before the first dot. Unicode letters are kept (NFC-normalised so macOS and Windows agree). Capped at `max` characters
// and `maxBytes` UTF-8 bytes (ext4/APFS allow 255 bytes per name; 200 leaves room for suffixes), cutting whole code points.
// Limit: it does not know the extension, so for a filename pass the base name and add the extension yourself.
const DEVICE = /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i;
const utf8 = new TextEncoder();

export function safeName(input: string, fallback: string, max = 80, maxBytes = 200): string {
  let s = input.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, "_").replace(/\s+/g, "_").replace(/_+/g, "_");
  const chars = Array.from(s).slice(0, max);
  while (utf8.encode(chars.join("")).length > maxBytes) chars.pop();
  s = chars.join("").replace(/^[._ ]+|[._ ]+$/g, "");
  if (s === "") return fallback;
  const dot = s.indexOf(".");
  const stem = dot === -1 ? s : s.slice(0, dot);
  return DEVICE.test(stem) ? `${stem}_${s.slice(stem.length)}` : s;
}
