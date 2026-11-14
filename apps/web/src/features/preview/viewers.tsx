import type { FileEntry } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { ChevronDown, ChevronRight, Copy, FileArchive, Folder, Maximize2, Minus, Plus, RotateCw, Search, WrapText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/misc";
import { useFileUrls } from "@/features/files/urls";
import { decodeText, listZip, parseCsv, useBytes, type ZipEntry } from "./data";

const Msg = ({ children }: { children: React.ReactNode }) => <div className="grid h-full place-items-center p-8 text-center text-[14px] text-muted">{children}</div>;
const Loading = () => <div className="grid h-full place-items-center"><Spinner className="size-6" /></div>;
const Toolbar = ({ children }: { children: React.ReactNode }) => <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-3 py-2 text-[13px]">{children}</div>;

/* ---------- image: fast rendition, zoom, pan, rotate ---------- */
export function ImageViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls();
  const [orig, setOrig] = useState(!f.hasThumbnail); const [loaded, setLoaded] = useState(false);
  const [z, setZ] = useState(1); const [pos, setPos] = useState({ x: 0, y: 0 }); const [rot, setRot] = useState(0);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => { setZ(1); setPos({ x: 0, y: 0 }); setRot(0); setLoaded(false); setOrig(!f.hasThumbnail); }, [f.id, f.hasThumbnail]);
  const zoom = (d: number) => setZ((v) => { const n = Math.min(8, Math.max(0.5, v * d)); if (n <= 1) setPos({ x: 0, y: 0 }); return n; });
  const src = orig ? urls.preview(f) : urls.thumb(f, z > 1.4 ? 2048 : 1024);
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <IconButton label="Perkecil" onClick={() => zoom(1 / 1.25)}><Minus className="size-4" /></IconButton>
        <span className="tnum w-12 text-center text-muted">{Math.round(z * 100)}%</span>
        <IconButton label="Perbesar" onClick={() => zoom(1.25)}><Plus className="size-4" /></IconButton>
        <IconButton label="Pas ke layar" onClick={() => { setZ(1); setPos({ x: 0, y: 0 }); }}><Maximize2 className="size-4" /></IconButton>
        <IconButton label="Putar 90°" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw className="size-4" /></IconButton>
        <span className="flex-1" />
        {f.hasThumbnail && <button className={cn("rounded-md px-2.5 py-1 text-[12px]", orig ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")} onClick={() => { setOrig((o) => !o); setLoaded(false); }}>{orig ? "Resolusi asli" : "Muat resolusi asli"}</button>}
      </Toolbar>
      <div
        className={cn("relative min-h-0 flex-1 overflow-hidden bg-[#0d1626] select-none", z > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")} style={{ touchAction: "none" }}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
        onDoubleClick={() => { if (z > 1) { setZ(1); setPos({ x: 0, y: 0 }); } else setZ(2.5); }}
        onPointerDown={(e) => { if (z <= 1) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        {f.hasThumbnail && !orig && <img src={urls.thumb(f, 256)} alt="" aria-hidden draggable={false} className="absolute inset-0 m-auto max-h-full max-w-full scale-100 object-contain blur-[2px]" style={{ transform: `rotate(${rot}deg)`, opacity: loaded ? 0 : 1, transition: "opacity 150ms" }} />}
        {!loaded && <div className="absolute inset-0 grid place-items-center"><Spinner className="size-6 text-white/70" /></div>}
        <img key={f.id + String(orig)} src={src} alt={f.name} decoding="async" draggable={false} onLoad={() => setLoaded(true)} onError={() => { if (!orig) setOrig(true); }}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain transition-opacity duration-150" style={{ opacity: loaded ? 1 : 0, transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg) scale(${z})` }} />
      </div>
    </div>
  );
}

/* ---------- video / audio ---------- */
export { VideoPlayer as VideoViewer } from "./VideoPlayer";
export function AudioViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls();
  return <div className="grid h-full place-items-center bg-surface-2 p-8"><div className="w-full max-w-xl text-center"><p className="mb-4 truncate text-[15px] font-medium">{f.name}</p><audio key={f.id} src={urls.preview(f)} controls autoPlay className="w-full" /></div></div>;
}

/* ---------- text / code ---------- */
export function TextViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const b = useBytes(urls.preview(f), 1024 * 1024);
  const [wrap, setWrap] = useState(false); const [q, setQ] = useState("");
  const text = useMemo(() => (b.data ? decodeText(b.data.buf) : ""), [b.data]);
  const lines = useMemo(() => text.split("\n"), [text]);
  if (b.loading) return <Loading />; if (b.error) return <Msg>{b.error}</Msg>;
  const needle = q.trim().toLowerCase();
  const matches = needle ? lines.reduce((n, l) => n + (l.toLowerCase().includes(needle) ? 1 : 0), 0) : 0;
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari di teks" aria-label="Cari di teks" className="h-8 w-48 rounded-md bg-surface-2 pr-2 pl-7 text-[13px] focus:ring-2 focus:ring-primary/30 focus:outline-none" /></div>
        {needle && <span className="tnum text-muted">{matches} baris cocok</span>}
        <span className="flex-1" />
        <button aria-pressed={wrap} onClick={() => setWrap((w) => !w)} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1", wrap ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")}><WrapText className="size-3.5" />Bungkus baris</button>
        <button onClick={() => void navigator.clipboard.writeText(text)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-surface-2"><Copy className="size-3.5" />Salin</button>
      </Toolbar>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface font-mono text-[12.5px] leading-[1.6]">
        <table className="w-full border-collapse"><tbody>
          {lines.slice(0, 20000).map((l, i) => { const hit = needle && l.toLowerCase().includes(needle); return (
            <tr key={i} className={hit ? "bg-warn-soft" : undefined}><td className="tnum sticky left-0 w-12 border-r border-line bg-surface-2 px-2 text-right text-faint select-none">{i + 1}</td><td className={cn("px-3", wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre")}>{l || " "}</td></tr>); })}
        </tbody></table>
        {(b.data?.truncated || lines.length > 20000) && <p className="border-t border-line bg-surface-2 px-3 py-2 text-[12px] text-muted">Hanya bagian awal yang ditampilkan. Unduh untuk melihat seluruhnya.</p>}
      </div>
    </div>
  );
}

/* ---------- JSON tree ---------- */
function Node({ k, v, depth, open }: { k?: string; v: unknown; depth: number; open: boolean }) {
  const isObj = v !== null && typeof v === "object"; const [o, setO] = useState(open && depth < 2); const [more, setMore] = useState(100);
  const keyEl = k !== undefined && <span className="text-primary-ink">{k}</span>;
  if (!isObj) return <div className="py-px pl-5">{keyEl}{k !== undefined && <span className="text-muted">: </span>}<span className={typeof v === "string" ? "text-ok-ink" : typeof v === "number" ? "text-warn-ink" : "text-violet-ink"}>{typeof v === "string" ? JSON.stringify(v) : String(v)}</span></div>;
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as object);
  return (
    <div>
      <button className="flex items-center gap-1 py-px text-left hover:bg-surface-2" onClick={() => setO(!o)}>{o ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}{keyEl}{k !== undefined && <span className="text-muted">: </span>}<span className="text-muted">{Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}</span></button>
      {o && <div className="ml-3 border-l border-line pl-2">{entries.slice(0, more).map(([kk, vv]) => <Node key={kk} k={kk} v={vv} depth={depth + 1} open={open} />)}
        {entries.length > more && <button className="py-1 pl-5 text-[12px] text-primary-ink hover:underline" onClick={() => setMore(more + 200)}>Tampilkan lebih banyak ({entries.length - more})</button>}</div>}
    </div>
  );
}
export function JsonViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const b = useBytes(urls.preview(f), 8 * 1024 * 1024);
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => { if (!b.data || b.data.truncated) return { ok: false as const }; try { return { ok: true as const, v: JSON.parse(decodeText(b.data.buf)) }; } catch { return { ok: false as const }; } }, [b.data]);
  if (b.loading) return <Loading />; if (b.error) return <Msg>{b.error}</Msg>;
  if (!parsed.ok || raw) return (<div className="flex h-full flex-col">{parsed.ok && <Toolbar><button className="rounded-md px-2 py-1 text-primary-ink hover:bg-primary-soft" onClick={() => setRaw(false)}>Tampilan pohon</button></Toolbar>}{!parsed.ok && <p className="border-b border-line bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">JSON tidak valid atau terlalu besar untuk pohon; ditampilkan sebagai teks.</p>}<div className="min-h-0 flex-1"><TextViewer f={f} /></div></div>);
  return (
    <div className="flex h-full flex-col"><Toolbar><span className="text-muted">Klik panah untuk membuka/menutup</span><span className="flex-1" /><button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" onClick={() => setRaw(true)}>Lihat mentah</button></Toolbar>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface p-3 font-mono text-[12.5px]"><Node v={parsed.v} depth={0} open /></div></div>
  );
}

/* ---------- table (CSV / Excel) ---------- */
function Grid({ rows, note }: { rows: (string | number | boolean | Date | null | undefined)[][]; note?: string }) {
  const [q, setQ] = useState("");
  const head = rows[0] ?? []; const body = rows.slice(1);
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return n ? body.filter((r) => r.some((c) => String(c ?? "").toLowerCase().includes(n))) : body; }, [body, q]);
  const cols = Math.min(Math.max(...rows.map((r) => r.length), 1), 60);
  const fmt = (c: unknown) => (c instanceof Date ? c.toLocaleDateString("id-ID") : c === null || c === undefined ? "" : String(c));
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari di tabel" aria-label="Cari di tabel" className="h-8 w-48 rounded-md bg-surface-2 pr-2 pl-7 text-[13px] focus:ring-2 focus:ring-primary/30 focus:outline-none" /></div>
        <span className="tnum text-muted">{shown.length.toLocaleString("id-ID")} baris · {cols} kolom</span>
      </Toolbar>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface">
        <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
          <thead className="sticky top-0 z-10"><tr><th className="sticky left-0 z-20 border-r border-b border-line bg-surface-2 px-2 py-1.5 text-faint" />{Array.from({ length: cols }, (_, i) => <th key={i} className="max-w-64 min-w-24 border-r border-b border-line bg-surface-2 px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{fmt(head[i]) || String.fromCharCode(65 + (i % 26))}</th>)}</tr></thead>
          <tbody>{shown.slice(0, 2000).map((r, i) => <tr key={i} className="hover:bg-surface-2/60"><td className="tnum sticky left-0 border-r border-b border-line bg-surface-2 px-2 text-right text-faint">{i + 1}</td>{Array.from({ length: cols }, (_, c) => <td key={c} className="max-w-64 truncate border-r border-b border-line px-2.5 py-1" title={fmt(r[c])}>{fmt(r[c])}</td>)}</tr>)}</tbody>
        </table>
        {(shown.length > 2000 || note) && <p className="border-t border-line bg-surface-2 px-3 py-2 text-[12px] text-muted">{shown.length > 2000 ? `Menampilkan 2.000 baris pertama dari ${shown.length.toLocaleString("id-ID")}. ` : ""}{note}</p>}
      </div>
    </div>
  );
}
export function CsvViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const b = useBytes(urls.preview(f), 4 * 1024 * 1024);
  const parsed = useMemo(() => (b.data ? parseCsv(decodeText(b.data.buf), 20000) : null), [b.data]);
  if (b.loading) return <Loading />; if (b.error || !parsed) return <Msg>{b.error}</Msg>;
  return <Grid rows={parsed.rows} note={b.data?.truncated ? "Hanya 4 MB pertama yang dimuat." : undefined} />;
}
export function XlsxViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const b = useBytes(urls.preview(f), undefined, 30 * 1024 * 1024, f.size);
  const [sheets, setSheets] = useState<{ sheet: string; data: any[][] }[] | null>(null); const [err, setErr] = useState<string | null>(null); const [active, setActive] = useState(0);
  useEffect(() => {
    if (!b.data) return; let dead = false;
    import("read-excel-file/browser").then(async (m) => { const r = await m.default(new Blob([b.data!.buf]) as any); if (!dead) setSheets(r as any); }).catch(() => !dead && setErr("Tidak dapat membaca spreadsheet ini (format .xls lama tidak didukung)."));
    return () => { dead = true; };
  }, [b.data]);
  if (b.loading || (!sheets && !err && !b.error)) return <Loading />; if (b.error || err) return <Msg>{b.error ?? err}</Msg>;
  return (
    <div className="flex h-full flex-col"><div className="min-h-0 flex-1"><Grid key={active} rows={sheets![active]?.data ?? []} /></div>
      {sheets!.length > 1 && <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-line bg-surface-2 px-2 py-1.5">{sheets!.map((s, i) => <button key={s.sheet} onClick={() => setActive(i)} className={cn("rounded-md px-3 py-1 text-[12px] whitespace-nowrap", i === active ? "bg-surface font-semibold shadow-card" : "text-muted hover:text-ink")}>{s.sheet}</button>)}</div>}</div>
  );
}

/* ---------- docx ---------- */
export function DocxViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const b = useBytes(urls.preview(f), undefined, 30 * 1024 * 1024, f.size);
  const [html, setHtml] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!b.data) return; let dead = false;
    import("mammoth").then(async (m) => { const r = await (m.default ?? m).convertToHtml({ arrayBuffer: b.data!.buf }); if (!dead) setHtml(r.value); }).catch(() => !dead && setErr("Tidak dapat membaca dokumen ini."));
    return () => { dead = true; };
  }, [b.data]);
  if (b.loading || (html === null && !err && !b.error)) return <Loading />; if (b.error || err) return <Msg>{b.error ?? err}</Msg>;
  // The converted HTML is rendered in a sandboxed frame with no scripts, so document content can never run code in the app.
  const doc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font:15px/1.6 system-ui,sans-serif;max-width:800px;margin:24px auto;padding:0 24px;color:#172b4d}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d3dbe6;padding:6px 10px}h1,h2,h3{line-height:1.25}</style>${html}`;
  return <iframe title={f.name} sandbox="" srcDoc={doc} className="size-full bg-white" />;
}

/* ---------- zip ---------- */
export function ZipViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const [entries, setEntries] = useState<ZipEntry[] | null>(null); const [err, setErr] = useState<string | null>(null); const [q, setQ] = useState("");
  useEffect(() => {
    const ac = new AbortController(); setEntries(null); setErr(null);
    if (!f.size) { setErr("Ukuran arsip tidak diketahui."); return; }
    listZip(urls.preview(f), f.size, ac.signal).then(setEntries).catch((e) => !ac.signal.aborted && setErr((e as Error).message));
    return () => ac.abort();
  }, [f.id, f.size]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Msg>{err}</Msg>; if (!entries) return <Loading />;
  const n = q.trim().toLowerCase(); const shown = n ? entries.filter((e) => e.name.toLowerCase().includes(n)) : entries;
  const files = entries.filter((e) => !e.isDir); const total = files.reduce((a, e) => a + e.size, 0), packed = files.reduce((a, e) => a + e.packed, 0);
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama" aria-label="Cari di arsip" className="h-8 w-48 rounded-md bg-surface-2 pr-2 pl-7 text-[13px] focus:ring-2 focus:ring-primary/30 focus:outline-none" /></div>
        <span className="tnum text-muted">{files.length.toLocaleString("id-ID")} file · {formatBytes(total)} · terkompres {formatBytes(packed)}{total ? ` (${Math.round((packed / total) * 100)}%)` : ""}</span>
      </Toolbar>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface">
        <table className="w-full text-[13px]"><thead className="sticky top-0 bg-surface-2 text-left text-[12px] text-muted"><tr><th className="px-3 py-1.5 font-semibold">Nama</th><th className="px-3 py-1.5 text-right font-semibold">Ukuran</th><th className="px-3 py-1.5 text-right font-semibold">Terkompres</th><th className="hidden px-3 py-1.5 font-semibold sm:table-cell">Diubah</th></tr></thead>
          <tbody className="divide-y divide-line">{shown.slice(0, 3000).map((e, i) => (
            <tr key={i}><td className="max-w-0 px-3 py-1.5"><span className="flex items-center gap-2 truncate">{e.isDir ? <Folder className="size-4 shrink-0 text-primary-ink" /> : <FileArchive className="size-4 shrink-0 text-muted" />}<span className="truncate" title={e.name}>{e.name}</span>{e.encrypted && <span className="rounded bg-warn-soft px-1.5 text-[11px] text-warn-ink">terkunci</span>}</span></td>
              <td className="tnum px-3 py-1.5 text-right text-muted">{e.isDir ? "" : formatBytes(e.size)}</td><td className="tnum px-3 py-1.5 text-right text-muted">{e.isDir ? "" : formatBytes(e.packed)}</td><td className="tnum hidden px-3 py-1.5 text-muted sm:table-cell">{e.modified?.toLocaleDateString("id-ID") ?? ""}</td></tr>))}</tbody></table>
        {shown.length > 3000 && <p className="border-t border-line bg-surface-2 px-3 py-2 text-[12px] text-muted">Menampilkan 3.000 dari {shown.length.toLocaleString("id-ID")}. Gunakan pencarian untuk mempersempit.</p>}
      </div>
    </div>
  );
}
