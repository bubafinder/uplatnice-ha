// Receipt file helpers: content sniffing and a minimal ZIP writer (stored entries, no compression)
import { crc32 } from 'node:zlib';

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024; // Home Assistant Ingress rejects bodies above ~16 MB

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export type ReceiptMime = (typeof ALLOWED)[number];

/** Detects the file type from its first bytes; returns null for anything that is not an allowed receipt format. */
export function sniffMime(buf: Buffer): ReceiptMime | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

export const extensionFor = (mime: string) =>
  ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })[mime] ?? 'bin';

/** Keeps a file name safe for headers and ZIP entries. */
export function cleanFileName(name: string, mime: string): string {
  const base = name
    .normalize('NFC')
    .replace(/\.{2,}/g, '.')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .trim()
    .slice(0, 120);
  const ext = extensionFor(mime);
  if (!base) return `potvrda.${ext}`;
  return /\.[A-Za-z0-9]{2,5}$/.test(base) ? base : `${base}.${ext}`;
}

/** RFC 6266 Content-Disposition with a UTF-8 file name. */
export const contentDisposition = (type: 'inline' | 'attachment', name: string) =>
  `${type}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export interface ZipEntry {
  name: string; // path inside the archive, '/' separated
  data: () => Buffer; // loaded lazily, one entry at a time
  date?: Date;
}

/**
 * Writes a ZIP archive with stored (uncompressed) entries. Receipts are PDFs and JPEGs that are
 * already compressed, so storing them keeps the code small without losing much space.
 */
export function writeZip(entries: ZipEntry[], write: (chunk: Buffer) => void) {
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data();
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosDateTime(e.date ?? new Date());
    if (offset + data.length > 0xffffffff) throw new Error('Archive too large');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    write(local);
    write(name);
    write(data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  write(cdBuf);
  write(end);
}
