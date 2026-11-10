import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// Minimal zip reader for tests (central directory, stored/deflated entries): name -> content. Enough to read back what archiver writes.
export function readZip(file: string): Map<string, Buffer> {
  const buf = readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export type ZipSpec = { name: string; data?: Buffer | string; mode?: number; host?: number; flags?: number; method?: number; declaredSize?: number; compressedSize?: number };

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Writes a zip with exactly the entries given (stored, no compression), so tests can make ones no honest tool would: "../x" names,
// symlinks (mode 0o120777), duplicates, lying sizes. `host` 3 = Unix, so `mode` is read from the attributes.
export function writeZip(file: string, entries: ZipSpec[]): void {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data ?? "");
    const flags = e.flags ?? 0x800;
    const usize = e.declaredSize ?? data.length;
    const csize = e.compressedSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(e.method ?? 0, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(csize, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(((e.host ?? 3) << 8) | 20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(flags, 8);
    head.writeUInt16LE(e.method ?? 0, 10); head.writeUInt32LE(crc32(data), 16); head.writeUInt32LE(csize, 20); head.writeUInt32LE(usize, 24);
    head.writeUInt16LE(name.length, 28); head.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38); head.writeUInt32LE(offset, 42);
    central.push(head, name);
    parts.push(local, name, data);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...parts, cd, end]));
}

// Copies a zip through `change` (name -> bytes in, out): add, drop or alter entries of a real backup.
export function rewriteZip(from: string, to: string, change: (entries: Map<string, Buffer>) => void, extra: ZipSpec[] = []): void {
  const m = readZip(from);
  change(m);
  writeZip(to, [...[...m].map(([name, data]) => ({ name, data })), ...extra]);
}
