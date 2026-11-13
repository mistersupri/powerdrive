import { useEffect, useState } from "react";

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean }

/** Fetch bytes of a file (optionally only the first `limit`) with abort on unmount. */
export function useBytes(url: string, limit?: number, max = 40 * 1024 * 1024, size?: number | null): Loaded<{ buf: ArrayBuffer; truncated: boolean }> {
  const [s, setS] = useState<Loaded<{ buf: ArrayBuffer; truncated: boolean }>>({ data: null, error: null, loading: true });
  useEffect(() => {
    const ac = new AbortController(); setS({ data: null, error: null, loading: true });
    if (!limit && size && size > max) { setS({ data: null, loading: false, error: `File terlalu besar untuk dipratinjau (${(size / 1048576).toFixed(0)} MB). Unduh untuk membukanya.` }); return; }
    fetch(url, { signal: ac.signal, headers: limit ? { range: `bytes=0-${limit - 1}` } : undefined })
      .then(async (r) => {
        if (!r.ok && r.status !== 206) throw new Error(r.status === 404 ? "File tidak ditemukan." : `Gagal memuat (HTTP ${r.status}).`);
        const buf = await r.arrayBuffer();
        const total = r.status === 206 ? Number((r.headers.get("content-range") ?? "").split("/")[1]) : buf.byteLength;
        setS({ data: { buf, truncated: !!limit && Number.isFinite(total) && total > buf.byteLength }, error: null, loading: false });
      })
      .catch((e) => { if (!ac.signal.aborted) setS({ data: null, error: (e as Error).message || "Gagal memuat.", loading: false }); });
    return () => ac.abort();
  }, [url, limit, max, size]);
  return s;
}

export const decodeText = (buf: ArrayBuffer) => new TextDecoder("utf-8", { fatal: false }).decode(buf);

/** RFC 4180 CSV parser with delimiter detection. Handles quotes, escaped quotes and newlines inside cells. */
export function parseCsv(text: string, maxRows = 5000): { rows: string[][]; delimiter: string } {
  const first = text.slice(0, 2000).split("\n")[0] ?? "";
  const delimiter = ([",", ";", "\t", "|"] as const).map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === "") q = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if ((cell !== "" || row.length) && rows.length < maxRows) { row.push(cell); rows.push(row); }
  return { rows, delimiter };
}

export interface ZipEntry { name: string; size: number; packed: number; modified: Date | null; isDir: boolean; encrypted: boolean }

/**
 * Lists a ZIP without downloading it: reads the end-of-central-directory record, then only the central directory,
 * using Range requests. Handles ZIP64.
 */
export async function listZip(url: string, size: number, signal?: AbortSignal): Promise<ZipEntry[]> {
  const get = async (start: number, end: number) => {
    const r = await fetch(url, { signal, headers: { range: `bytes=${start}-${end}` } });
    if (!r.ok && r.status !== 206) throw new Error("Tidak dapat membaca arsip.");
    const b = await r.arrayBuffer();
    // A server that ignores Range returns everything; slice what we asked for.
    return r.status === 200 ? b.slice(start, end + 1) : b;
  };
  const tailLen = Math.min(size, 65557 + 20 + 56);
  const tail = new DataView(await get(size - tailLen, size - 1));
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Bukan arsip ZIP yang valid.");
  let total = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || total === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const off64 = Number(tail.getBigUint64(loc + 8, true));
      const e64 = new DataView(await get(off64, off64 + 55));
      total = Number(e64.getBigUint64(32, true)); cdSize = Number(e64.getBigUint64(40, true)); cdOff = Number(e64.getBigUint64(48, true));
    }
  }
  if (cdSize > 64 * 1024 * 1024) throw new Error("Daftar isi arsip terlalu besar.");
  const cd = new DataView(await get(cdOff, cdOff + cdSize - 1));
  const out: ZipEntry[] = []; let p = 0;
  while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50 && out.length < 50000) {
    const flags = cd.getUint16(p + 8, true), time = cd.getUint16(p + 12, true), date = cd.getUint16(p + 14, true);
    let packed = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "utf-8", { fatal: false }).decode(nameBytes);
    if (usize === 0xffffffff || packed === 0xffffffff) { // ZIP64 extra field
      let e = p + 46 + nlen; const end = e + elen;
      while (e + 4 <= end) { const id = cd.getUint16(e, true), len = cd.getUint16(e + 2, true); if (id === 1) { let o = e + 4; if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(o, true)); o += 8; } if (packed === 0xffffffff) packed = Number(cd.getBigUint64(o, true)); break; } e += 4 + len; }
    }
    const modified = date ? new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0xf) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2) : null;
    out.push({ name, size: usize, packed, modified, isDir: name.endsWith("/"), encrypted: !!(flags & 1) });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
