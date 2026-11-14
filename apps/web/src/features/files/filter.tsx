import type { FileEntry } from "@superdrive/shared";
import { Filter, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { kindOf, type FileKind } from "@/lib/fileType";
import { Button } from "@/ui/Button";
import { Input, Select } from "@/ui/Field";

export interface FilterState {
  q: string; ext: string; types: FileKind[]; sizeMin: string; sizeMax: string; sizeUnit: "KB" | "MB" | "GB"; from: string; to: string; starred: boolean;
}
export const emptyFilter: FilterState = { q: "", ext: "", types: [], sizeMin: "", sizeMax: "", sizeUnit: "MB", from: "", to: "", starred: false };

const UNIT = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
export const TYPE_OPTIONS: { v: FileKind; label: string }[] = [
  { v: "folder", label: "Folder" }, { v: "image", label: "Gambar" }, { v: "video", label: "Video" }, { v: "audio", label: "Audio" }, { v: "pdf", label: "PDF" },
  { v: "doc", label: "Dokumen" }, { v: "sheet", label: "Spreadsheet" }, { v: "slides", label: "Presentasi" }, { v: "text", label: "Teks" }, { v: "code", label: "Kode" }, { v: "archive", label: "Arsip" },
];
export const sizeBytes = (v: string, unit: FilterState["sizeUnit"]) => (v.trim() === "" || isNaN(Number(v)) ? undefined : Math.round(Number(v) * UNIT[unit]));
const dayStart = (d: string) => new Date(`${d}T00:00:00`).getTime();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

export function activeFilterCount(f: FilterState) {
  return [f.q.trim(), f.ext.trim(), f.types.length, f.sizeMin, f.sizeMax, f.from, f.to, f.starred].filter(Boolean).length;
}

/** Client-side filtering of a loaded folder. */
export function applyFilter(list: FileEntry[], f: FilterState): FileEntry[] {
  if (!activeFilterCount(f)) return list;
  const q = f.q.trim().toLowerCase(); const exts = f.ext.split(/[,\s]+/).map((e) => e.replace(/^\./, "").toLowerCase()).filter(Boolean);
  const min = sizeBytes(f.sizeMin, f.sizeUnit), max = sizeBytes(f.sizeMax, f.sizeUnit);
  const from = f.from ? dayStart(f.from) : undefined, to = f.to ? dayEnd(f.to) : undefined;
  return list.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (f.types.length && !f.types.includes(kindOf(e))) return false;
    if (exts.length && (e.isFolder || !exts.includes(e.name.split(".").pop()?.toLowerCase() ?? ""))) return false;
    if (f.starred && !e.starred) return false;
    if (min !== undefined || max !== undefined) { if (e.isFolder || e.size === null || (min !== undefined && e.size < min) || (max !== undefined && e.size > max)) return false; }
    if (from !== undefined || to !== undefined) { const t = e.modifiedAt ? new Date(e.modifiedAt).getTime() : NaN; if (isNaN(t) || (from !== undefined && t < from) || (to !== undefined && t > to)) return false; }
    return true;
  });
}

/** Query string for the server-side search endpoint. */
export function filterToQuery(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.ext.trim()) p.set("ext", f.ext.split(/[,\s]+/).filter(Boolean).join(","));
  const min = sizeBytes(f.sizeMin, f.sizeUnit), max = sizeBytes(f.sizeMax, f.sizeUnit);
  if (min !== undefined) p.set("minSize", String(min)); if (max !== undefined) p.set("maxSize", String(max));
  if (f.from) p.set("modifiedAfter", new Date(dayStart(f.from)).toISOString()); if (f.to) p.set("modifiedBefore", new Date(dayEnd(f.to)).toISOString());
  if (f.starred) p.set("starred", "true");
  return p.toString();
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Hari ini", range: () => [iso(new Date()), iso(new Date())] },
  { label: "7 hari", range: () => [iso(new Date(Date.now() - 6 * 864e5)), iso(new Date())] },
  { label: "30 hari", range: () => [iso(new Date(Date.now() - 29 * 864e5)), iso(new Date())] },
  { label: "Tahun ini", range: () => [`${new Date().getFullYear()}-01-01`, iso(new Date())] },
];

export function FilterButton({ value, onChange, showName = true }: { value: FilterState; onChange(f: FilterState): void; showName?: boolean }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const n = activeFilterCount(value);
  useEffect(() => {
    if (!open) return;
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", d); addEventListener("keydown", k); return () => { removeEventListener("mousedown", d); removeEventListener("keydown", k); };
  }, [open]);
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  const toggleType = (t: FileKind) => set({ types: value.types.includes(t) ? value.types.filter((x) => x !== t) : [...value.types, t] });
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant={n ? "soft" : "secondary"} aria-expanded={open} aria-haspopup="dialog" icon={<Filter className="size-4" />} onClick={() => setOpen((o) => !o)}>
        Filter{n > 0 && <span className="tnum ml-0.5 grid size-[18px] place-items-center rounded-full bg-primary text-[11px] font-semibold text-white">{n}</span>}
      </Button>
      {open && (
        <div role="dialog" aria-label="Filter lanjutan" className="anim-pop absolute left-0 z-40 mt-2 w-[min(380px,calc(100vw-2rem))] max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:mt-0 max-sm:max-h-[80dvh] max-sm:w-auto max-sm:overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-float">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-[14px] font-semibold">Filter lanjutan</h3>
            <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40" disabled={!n} onClick={() => onChange(emptyFilter)}><RotateCcw className="size-3" />Reset</button></div>
          <div className="space-y-4">
            {showName && <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Nama mengandung</span><Input value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder="mis. laporan" className="h-9" /></label>}
            <div><span className="mb-1.5 block text-[12px] font-medium text-muted">Jenis</span>
              <div className="flex flex-wrap gap-1.5">{TYPE_OPTIONS.map((t) => <button key={t.v} aria-pressed={value.types.includes(t.v)} onClick={() => toggleType(t.v)} className={cn("h-7 rounded-full px-2.5 text-[12px] transition-colors", value.types.includes(t.v) ? "bg-primary text-white" : "bg-surface-2 text-muted hover:text-ink")}>{t.label}</button>)}</div></div>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Ekstensi</span><Input value={value.ext} onChange={(e) => set({ ext: e.target.value })} placeholder="jpg, png, pdf" className="h-9" /></label>
            <div><span className="mb-1 block text-[12px] font-medium text-muted">Ukuran</span>
              <div className="flex items-center gap-2"><Input inputMode="decimal" value={value.sizeMin} onChange={(e) => set({ sizeMin: e.target.value })} placeholder="Min" className="h-9" aria-label="Ukuran minimum" />
                <span className="text-muted">–</span><Input inputMode="decimal" value={value.sizeMax} onChange={(e) => set({ sizeMax: e.target.value })} placeholder="Maks" className="h-9" aria-label="Ukuran maksimum" />
                <Select aria-label="Satuan" value={value.sizeUnit} onChange={(e) => set({ sizeUnit: e.target.value as FilterState["sizeUnit"] })} className="h-9 w-20"><option>KB</option><option>MB</option><option>GB</option></Select></div></div>
            <div><span className="mb-1 block text-[12px] font-medium text-muted">Terakhir diubah</span>
              <div className="flex items-center gap-2"><Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} className="h-9" aria-label="Dari tanggal" /><span className="text-muted">–</span><Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} className="h-9" aria-label="Sampai tanggal" /></div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p.label} onClick={() => { const [a, b] = p.range(); set({ from: a, to: b }); }} className="h-6 rounded-md bg-surface-2 px-2 text-[11px] text-muted hover:text-ink">{p.label}</button>)}</div></div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.starred} onChange={(e) => set({ starred: e.target.checked })} />Hanya yang berbintang</label>
          </div>
        </div>)}
    </div>
  );
}

/** Active filters as removable chips, so it is always obvious why items are hidden. */
export function FilterChips({ value, onChange }: { value: FilterState; onChange(f: FilterState): void }) {
  const chips: { k: string; label: string; clear: Partial<FilterState> }[] = [];
  if (value.q.trim()) chips.push({ k: "q", label: `Nama: ${value.q}`, clear: { q: "" } });
  for (const t of value.types) chips.push({ k: `t-${t}`, label: TYPE_OPTIONS.find((o) => o.v === t)?.label ?? t, clear: { types: value.types.filter((x) => x !== t) } });
  if (value.ext.trim()) chips.push({ k: "ext", label: `Ekstensi: ${value.ext}`, clear: { ext: "" } });
  if (value.sizeMin || value.sizeMax) chips.push({ k: "size", label: `Ukuran ${value.sizeMin || "0"}–${value.sizeMax || "∞"} ${value.sizeUnit}`, clear: { sizeMin: "", sizeMax: "" } });
  if (value.from || value.to) chips.push({ k: "date", label: `Diubah ${value.from || "…"} → ${value.to || "…"}`, clear: { from: "", to: "" } });
  if (value.starred) chips.push({ k: "star", label: "Berbintang", clear: { starred: false } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2 sm:px-8" aria-label="Filter aktif">
      {chips.map((c) => <span key={c.k} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-0.5 pr-1 pl-2.5 text-[12px] text-primary-ink">{c.label}<button aria-label={`Hapus filter ${c.label}`} className="grid size-4 place-items-center rounded-full hover:bg-primary/15" onClick={() => onChange({ ...value, ...c.clear })}><X className="size-3" /></button></span>)}
      <button className="ml-1 text-[12px] text-muted hover:text-ink hover:underline" onClick={() => onChange(emptyFilter)}>Hapus semua</button>
    </div>
  );
}
