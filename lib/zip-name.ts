// Pure (no fs, no DB). <folder or title slug>-files-YYYYMMDD.zip from the local date; the name is cut to letters and digits joined by "-".
export function applicationZipName(folderOrTitle: string, now: Date): string {
  const slug = folderOrTitle.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "application";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${slug}-files-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.zip`;
}
