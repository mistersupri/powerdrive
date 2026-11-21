import type { FileEntry, StorageConnectionDto } from "@superdrive/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Check, Download, FolderMinus, FolderPlus, Images, Lock, Pencil, Play, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { PageHeader, useStorages } from "@/features/layout/Shell";
import { Preview } from "@/features/preview/Preview";
import { Button, IconButton } from "@/ui/Button";
import { Select } from "@/ui/Field";
import { EmptyState, Skeleton } from "@/ui/misc";
import { FileThumb } from "./FileThumb";
import { IndexBanner } from "./FilesPages";
import { toast } from "sonner";
import { DeleteDialog } from "./dialogs";
import { triggerDownload } from "./transferApi";
import { AddToAlbumDialog, AlbumGrid, FolderGrid, type Album, type MediaFolder } from "./AlbumsUi";
import { Dialog } from "@/ui/Dialog";
import { SlidingTabs } from "@/ui/SlidingTabs";
import { HighlightsStrip } from "./Highlights";
import { Input } from "@/ui/Field";

type Kind = "all" | "image" | "video";
type Mode = "all" | "folders" | "albums";
type Scope = { kind: "folder"; storageId: string; folderId: string; name: string } | { kind: "album"; id: string; name: string; isPrivate: boolean };
const PERIODS = [["all", "Semua waktu"], ["today", "Hari ini"], ["week", "7 hari terakhir"], ["month", "30 hari terakhir"], ["year", "Tahun ini"], ["range", "Rentang tanggal…"]] as const;
type Period = (typeof PERIODS)[number][0];
/** The period as the instants the server compares against (the browser's own days, as UTC). */
function periodRange(p: Period, from: string, to: string): { after?: string; before?: string } {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  if (p === "today") return { after: day(now).toISOString() };
  if (p === "week") { const d = day(now); d.setDate(d.getDate() - 6); return { after: d.toISOString() }; }
  if (p === "month") { const d = day(now); d.setDate(d.getDate() - 29); return { after: d.toISOString() }; }
  if (p === "year") return { after: new Date(now.getFullYear(), 0, 1).toISOString() };
  if (p === "range") return { after: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, before: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined };
  return {};
}
const monthName = (m: string) => (m.length >= 7 ? new Date(`${m.slice(0, 7)}-01T12:00:00`).toLocaleDateString("id-ID", { month: "short", year: "numeric" }) : "Tanpa tanggal");
interface Page { items: FileEntry[]; nextCursor: string | null; counts: { image: number; video: number } }
const GAP = 4;
const SORTS = [["date:desc", "Terbaru"], ["date:asc", "Terlama"], ["name:asc", "Nama A–Z"], ["name:desc", "Nama Z–A"], ["size:desc", "Terbesar"], ["size:asc", "Terkecil"]] as const;

const dayLabel = (iso: string | null) => {
  if (!iso) return "Tanpa tanggal"; const d = new Date(iso); const t = new Date(); const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(t) - day(d);
  if (diff === 0) return "Hari ini"; if (diff === 1) return "Kemarin";
  if (diff < 7) return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

type Row = { key: string; kind: "head"; label: string; count: number } | { key: string; kind: "tiles"; items: FileEntry[] };

/** Photos and videos from every connected storage, newest first, like a photo library. Reads the search index, so it fills in as storages are crawled. */
export default function MediaPage() {
  const storages = useStorages().data ?? []; const names = useMemo(() => Object.fromEntries(storages.map((s: StorageConnectionDto) => [s.id, s.isDefault ? "Semua file" : s.name])), [storages]);
  const [kind, setKind] = useState<Kind>("all"); const [storageId, setStorageId] = useState(""); const [open, setOpen] = useState<number | null>(null); const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("all"); const [scope, setScope] = useState<Scope | null>(null); const [memory, setMemory] = useState<{ items: FileEntry[]; index: number } | null>(null); const [addOpen, setAddOpen] = useState(false); const [renaming, setRenaming] = useState<string | null>(null); const [dropAlbum, setDropAlbum] = useState(false);
  const showGallery = mode === "all" || scope !== null;
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("date:desc"); const [confirmDelete, setConfirmDelete] = useState(false); const qc = useQueryClient();
  const [sortKey, sortDir] = sort.split(":") as [string, string];
  const [period, setPeriod] = useState<Period>("all"); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const { after, before } = useMemo(() => periodRange(period, from, to), [period, from, to]);
  const dateQs = `${after ? `&after=${encodeURIComponent(after)}` : ""}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  const scopeKey = scope?.kind === "album" ? scope.id : scope ? `${scope.storageId}/${scope.folderId}` : "";
  const scopeQs = `${scope?.kind === "folder" ? `&storageId=${scope.storageId}&folderId=${encodeURIComponent(scope.folderId)}` : storageId ? `&storageId=${storageId}` : ""}${scope?.kind === "album" ? `&albumId=${scope.id}` : ""}`;
  const timeline = useQuery({ enabled: showGallery, queryKey: ["media-timeline", kind, storageId, scopeKey, after, before], queryFn: () => api<{ months: { month: string; count: number }[] }>(`/media/timeline?kind=${kind}${scopeQs}${dateQs}`).then((r) => r.months), staleTime: 30_000 });
  const q = useInfiniteQuery({
    enabled: showGallery, queryKey: ["media", kind, storageId, sort, scopeKey, after, before], initialPageParam: "", getNextPageParam: (p: Page) => p.nextCursor ?? undefined, staleTime: 30_000,
    queryFn: ({ pageParam }) => api<Page>(`/media?kind=${kind}&limit=150&sort=${sortKey}&dir=${sortDir}${dateQs}${scope?.kind === "folder" ? `&storageId=${scope.storageId}&folderId=${encodeURIComponent(scope.folderId)}` : storageId ? `&storageId=${storageId}` : ""}${scope?.kind === "album" ? `&albumId=${scope.id}` : ""}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]); const counts = q.data?.pages[0]?.counts;
  const key = (e: FileEntry) => `${e.storageId}:${e.id}`;

  const box = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(360);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const cols = Math.max(3, Math.floor((width + GAP) / (width < 640 ? 112 : 168 + GAP))); const size = Math.floor((width - GAP * (cols - 1)) / cols);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = []; let i = 0;
    while (i < items.length) {
      // Day headings only make sense when the order is by date.
      const label = sortKey === "date" ? dayLabel(items[i]!.modifiedAt) : ""; let j = i; while (j < items.length && (sortKey !== "date" || dayLabel(items[j]!.modifiedAt) === label)) j++;
      if (sortKey === "date") out.push({ key: `h${i}`, kind: "head", label, count: j - i });
      for (let k = i; k < j; k += cols) out.push({ key: `t${k}`, kind: "tiles", items: items.slice(k, Math.min(j, k + cols)) });
      i = j;
    }
    return out;
  }, [items, cols, sortKey]);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => box.current, estimateSize: (i) => (rows[i]!.kind === "head" ? 48 : size + GAP), overscan: 6, getItemKey: (i) => rows[i]!.key });
  useEffect(() => { virt.measure(); }, [size, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pull the next page in before the end is reached.
  const vi = virt.getVirtualItems(); const lastShown = vi.at(-1)?.index ?? 0;
  useEffect(() => { if (q.hasNextPage && !q.isFetchingNextPage && rows.length - lastShown < 24) void q.fetchNextPage(); }, [lastShown, rows.length, q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (e: FileEntry) => setSel((c) => { const n = new Set(c); const k = key(e); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = items.filter((e) => sel.has(key(e))); const oneStorage = chosen.length > 0 && chosen.every((e) => e.storageId === chosen[0]!.storageId);
  const removeChosen = async () => {
    let failed = 0;
    for (const e of chosen) { try { await api(`/files/${e.storageId}/${e.id}`, { method: "DELETE" }); } catch (err) { failed++; toast.error(`${e.name}: ${(err as Error).message}`); } }
    if (failed < chosen.length) toast.success(`${chosen.length - failed} item dipindahkan ke sampah`);
    setSel(new Set()); setOpen(null); await qc.invalidateQueries({ queryKey: ["media"] });
  };
  const leaveAlbum = async () => {
    if (scope?.kind !== "album") return;
    try { await api(`/albums/${scope.id}/items/remove`, { body: { items: chosen.map((e) => ({ storageId: e.storageId, fileId: e.id })) } }); toast.success(`${chosen.length} item dikeluarkan dari album`); }
    catch (e) { toast.error((e as Error).message); }
    setSel(new Set()); await qc.invalidateQueries({ queryKey: ["media"] }); await qc.invalidateQueries({ queryKey: ["albums"] });
  };
  const removeAlbum = async () => { if (scope?.kind !== "album") return; try { await api(`/albums/${scope.id}`, { method: "DELETE" }); toast.success("Album dihapus. Foto di dalamnya tidak ikut terhapus."); setScope(null); setDropAlbum(false); await qc.invalidateQueries({ queryKey: ["albums"] }); await qc.invalidateQueries({ queryKey: ["media"] }); } catch (e) { toast.error((e as Error).message); } };
  const renameAlbum = async () => { if (scope?.kind !== "album" || renaming === null || !renaming.trim()) return; try { await api(`/albums/${scope.id}`, { method: "PATCH", body: { name: renaming } }); setScope({ ...scope, name: renaming.trim() }); setRenaming(null); await qc.invalidateQueries({ queryKey: ["albums"] }); } catch (e) { toast.error((e as Error).message); } };
  // Date scrubber: a handle on the right edge that drags through the whole library and names the month under it.
  const rowStart = useMemo(() => { let n = 0; return rows.map((r) => { const at = n; if (r.kind === "tiles") n += r.items.length; return at; }); }, [rows]);
  const total = kind === "image" ? (counts?.image ?? 0) : kind === "video" ? (counts?.video ?? 0) : counts ? counts.image + counts.video : 0;
  const months = useMemo(() => (sortDir === "asc" ? [...(timeline.data ?? [])].reverse() : (timeline.data ?? [])), [timeline.data, sortDir]);
  const monthAt = (idx: number) => { let acc = 0; for (const m of months) { acc += m.count; if (idx < acc) return monthName(m.month); } return months.length ? monthName(months[months.length - 1]!.month) : ""; };
  const [target, setTarget] = useState(-1); const [scrub, setScrub] = useState(false); const [label, setLabel] = useState("");
  useEffect(() => {
    if (target < 0 || !rows.length) return;
    if (target < items.length) { const r = rows.findIndex((x, i) => x.kind === "tiles" && rowStart[i]! <= target && target < rowStart[i]! + x.items.length); if (r >= 0) virt.scrollToIndex(r, { align: "start" }); if (!scrub) setTarget(-1); }
    else if (q.hasNextPage) { if (!q.isFetchingNextPage) void q.fetchNextPage(); }
    else { virt.scrollToIndex(rows.length - 1); if (!scrub) setTarget(-1); }
  }, [target, items.length, scrub, q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps
  const showScrubber = sortKey === "date" && total > 80 && months.length > 0 && rows.length > 0;
  const here = total > 1 ? (rowStart[vi[0]?.index ?? 0] ?? 0) / (total - 1) : 0;
  const shown = Math.min(1, Math.max(0, scrub && target >= 0 && total > 1 ? target / (total - 1) : here));
  const moveTo = (f: number) => { const idx = Math.round(Math.min(1, Math.max(0, f)) * Math.max(0, total - 1)); setTarget(idx); setLabel(monthAt(idx)); };

  const pickMode = (m: Mode) => { setMode(m); setScope(null); setSel(new Set()); };
  const empty = !q.isLoading && !items.length;
  const chip = (k: Kind, label: string, n?: number) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setSel(new Set()); }} className={cn("h-9 rounded-full px-3.5 text-[13px] font-medium pointer-coarse:h-11", kind === k ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")}>{label}{n !== undefined ? <span className="tnum ml-1.5 text-[12px] opacity-70">{n.toLocaleString("id-ID")}</span> : null}</button>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Media" subtitle="Foto dan video dari semua penyimpanan, terbaru di atas." />
      <div className="border-b border-line bg-surface px-4 pt-1.5 sm:px-8"><SlidingTabs label="Tampilan media" value={mode} onChange={pickMode} tabs={[["all", "Semua"], ["folders", "Folder"], ["albums", "Album"]] as const} /></div>
      {scope && (
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-4 py-1.5 sm:px-8">
          <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => { setScope(null); setSel(new Set()); }}>{mode === "albums" ? "Album" : "Folder"}</Button>
          <h2 className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[14px] font-semibold">{scope.kind === "album" && scope.isPrivate && <Lock className="size-4 shrink-0 text-muted" aria-label="Privat" />}<span className="truncate">{scope.name}</span></h2>
          {scope.kind === "album" && <>
            <Button size="sm" variant="ghost" iconOnlyMobile aria-label="Ganti nama album" icon={<Pencil className="size-4" />} onClick={() => setRenaming(scope.name)}>Ganti nama</Button>
            <Button size="sm" variant="ghost" iconOnlyMobile aria-label="Hapus album" className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink" icon={<Trash2 className="size-4" />} onClick={() => setDropAlbum(true)}>Hapus album</Button>
          </>}
        </div>)}
      {showGallery && <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-8">
        {kindChips(chip, counts)}
        <span className="flex-1" />
        <Select aria-label="Periode" value={period} onChange={(e) => { setPeriod(e.target.value as Period); setSel(new Set()); }} className={cn("h-9 w-40 text-[13px]", period !== "all" && "border-primary")}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        {period === "range" && <><Input type="date" aria-label="Dari tanggal" className="h-9 w-36 text-[13px]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /><span className="text-muted" aria-hidden>–</span><Input type="date" aria-label="Sampai tanggal" className="h-9 w-36 text-[13px]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></>}
        <Select aria-label="Urutkan" value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setSel(new Set()); }} className="h-9 w-32 text-[13px] sm:w-36">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        {chosen.length > 0 ? (<>
          <span className="tnum inline-flex items-center gap-1 rounded-lg bg-primary-soft py-1 pr-1 pl-2.5 text-[13px] font-medium text-primary-ink">{chosen.length} dipilih<IconButton label="Batal pilih" className="size-6" onClick={() => setSel(new Set())}><X className="size-3.5" /></IconButton></span>
          <Button size="sm" icon={<Download className="size-4" />} disabled={!oneStorage} title={oneStorage ? undefined : "Pilih dari satu penyimpanan untuk mengunduh sekaligus"} onClick={() => triggerDownload(chosen[0]!.storageId, chosen.map((e) => e.id), chosen.length === 1 ? chosen[0]!.name : undefined)}>Unduh{chosen.length > 1 ? " ZIP" : ""}</Button>
          <Button size="sm" iconOnlyMobile aria-label="Tambah ke album" title="Tambah ke album" icon={<FolderPlus className="size-4" />} onClick={() => setAddOpen(true)}>Album</Button>
          {scope?.kind === "album" && <Button size="sm" iconOnlyMobile aria-label="Keluarkan dari album" title="Keluarkan dari album" icon={<FolderMinus className="size-4" />} onClick={() => void leaveAlbum()}>Keluarkan</Button>}
          <Button size="sm" iconOnlyMobile aria-label="Hapus" title="Hapus" className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Hapus</Button>
        </>) : (
          <Select aria-label="Penyimpanan" value={storageId} onChange={(e) => { setStorageId(e.target.value); setSel(new Set()); }} className="h-9 w-full text-[13px] sm:w-52"><option value="">Semua penyimpanan</option>{storages.filter((s: StorageConnectionDto) => s.status === "CONNECTED").map((s: StorageConnectionDto) => <option key={s.id} value={s.id}>{s.isDefault ? "Semua file" : s.name}</option>)}</Select>)}
      </div>}
      {showGallery && <IndexBanner />}
      {mode === "all" && !scope && kind === "all" && chosen.length === 0 && <HighlightsStrip onOpen={(its) => setMemory({ items: its, index: 0 })} />}
      {!showGallery && <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 sm:px-8" role="region" aria-label={mode === "folders" ? "Folder berisi media" : "Album"}>
        {mode === "folders" ? <FolderGrid storageId="" onOpen={(f: MediaFolder) => setScope({ kind: "folder", storageId: f.storageId, folderId: f.folderId, name: f.name })} /> : <AlbumGrid onOpen={(a: Album) => setScope({ kind: "album", id: a.id, name: a.name, isPrivate: a.isPrivate })} />}
      </div>}
      <div className={cn("relative flex min-h-0 flex-1", !showGallery && "hidden")}>
      <div ref={box} className="scroll-thin relative min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-24 sm:px-8" role="region" aria-label="Galeri media">
        {q.isLoading ? <div className="grid grid-cols-3 gap-1 pt-4 sm:grid-cols-5">{Array.from({ length: 15 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
          : q.error ? <EmptyState icon={Images} title="Tidak dapat memuat media">{(q.error as Error).message}</EmptyState>
          : empty ? <EmptyState icon={Images} title="Belum ada foto atau video">Foto dan video muncul setelah penyimpanan Anda selesai diindeks. Penyimpanan cloud butuh beberapa saat; progresnya terlihat di banner di atas.</EmptyState> : (
            <div style={{ height: virt.getTotalSize(), position: "relative" }}>
              {vi.map((v) => { const r = rows[v.index]!; return (
                <div key={v.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: v.size, transform: `translateY(${v.start}px)` }}>
                  {r.kind === "head" ? <h2 className="flex h-12 items-end pb-1.5 text-[13px] font-semibold">{r.label}<span className="tnum ml-2 text-[12px] font-normal text-muted">{r.count.toLocaleString("id-ID")}</span></h2> : (
                    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap: GAP }}>
                      {r.items.map((e) => { const on = sel.has(key(e)); const video = e.mimeType?.startsWith("video/"); const idx = items.indexOf(e); return (
                        <div key={key(e)} className="group relative overflow-hidden rounded-md bg-surface-2" style={{ width: size, height: size }}>
                          <button type="button" className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" aria-label={`${video ? "Putar video" : "Buka foto"} ${e.name}, ${names[e.storageId] ?? ""}`} onClick={() => (sel.size ? toggle(e) : setOpen(idx))}>
                            <FileThumb file={e} size={256} className={cn("size-full transition-transform duration-150", on && "scale-90 rounded-lg")} />
                          </button>
                          {video && <span className="pointer-events-none absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white"><Play className="size-3 fill-current" aria-hidden /></span>}
                          <button type="button" role="checkbox" aria-checked={on} aria-label={`Pilih ${e.name}`} onClick={() => toggle(e)} className={cn("absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full border-2 transition-opacity after:absolute after:-inset-2.5 after:content-[''] focus-visible:opacity-100", on ? "border-primary bg-primary text-white opacity-100" : "border-white bg-black/20 text-transparent opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100")}><Check className="size-3.5" strokeWidth={3} aria-hidden /></button>
                        </div>); })}
                    </div>)}
                </div>); })}
            </div>)}
        {q.isFetchingNextPage && <p className="py-4 text-center text-[12px] text-muted" role="status">Memuat lebih banyak…</p>}
      </div>
      {showScrubber && (
        <div role="slider" tabIndex={0} aria-label="Gulir berdasarkan tanggal" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)} aria-valuetext={label || monthAt(Math.round(shown * Math.max(0, total - 1)))}
          className="group absolute top-2 right-0 bottom-24 w-7 cursor-grab touch-none select-none outline-none"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrub(true); const r = e.currentTarget.getBoundingClientRect(); moveTo((e.clientY - r.top - 20) / Math.max(1, r.height - 40)); }}
          onPointerMove={(e) => { if (!scrub) return; const r = e.currentTarget.getBoundingClientRect(); moveTo((e.clientY - r.top - 20) / Math.max(1, r.height - 40)); }}
          onPointerUp={() => { setScrub(false); setLabel(""); }} onPointerCancel={() => { setScrub(false); setLabel(""); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); moveTo(shown + (e.key === "PageDown" ? 0.1 : 0.02)); } else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); moveTo(shown - (e.key === "PageUp" ? 0.1 : 0.02)); } }}>
          <span aria-hidden className={cn("absolute right-1 h-10 w-1.5 rounded-full transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-primary", scrub ? "w-2 bg-primary opacity-100" : "bg-muted opacity-0 group-hover:opacity-70 group-focus-visible:opacity-80")} style={{ top: `calc((100% - 40px) * ${shown})` }} />
          {scrub && label && <span aria-hidden className="pointer-events-none absolute right-6 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-white shadow-float" style={{ top: `calc((100% - 40px) * ${shown} + 6px)` }}>{label}</span>}
        </div>)}
      </div>
      {memory && <Preview items={memory.items} index={memory.index} onIndex={(i) => setMemory({ ...memory, index: i })} onClose={() => setMemory(null)} storageName={names[memory.items[0]!.storageId]} location={undefined} />}
      <AddToAlbumDialog open={addOpen} items={chosen} onClose={() => setAddOpen(false)} onDone={() => setSel(new Set())} />
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} width="max-w-sm" title="Ganti nama album" footer={<><Button onClick={() => setRenaming(null)}>Batal</Button><Button variant="primary" disabled={!renaming?.trim()} onClick={() => void renameAlbum()}>Simpan</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void renameAlbum(); }}><Input aria-label="Nama album" autoFocus maxLength={80} value={renaming ?? ""} onChange={(e) => setRenaming(e.target.value)} /></form>
      </Dialog>
      <Dialog open={dropAlbum} onClose={() => setDropAlbum(false)} width="max-w-sm" title={`Hapus album “${scope?.kind === "album" ? scope.name : ""}”?`} footer={<><Button onClick={() => setDropAlbum(false)}>Batal</Button><Button variant="danger" onClick={() => void removeAlbum()}>Hapus album</Button></>}>
        <p className="text-[14px] text-muted">Hanya albumnya yang dihapus. Foto dan video di dalamnya tetap ada di penyimpanan{scope?.kind === "album" && scope.isPrivate ? " dan muncul kembali di galeri" : ""}.</p>
      </Dialog>
      <DeleteDialog open={confirmDelete} entries={chosen} onClose={() => setConfirmDelete(false)} onConfirm={removeChosen} />
      {open !== null && items[open] && (
        <Preview items={items} index={open} onIndex={(i) => { setOpen(i); if (i > items.length - 12 && q.hasNextPage) void q.fetchNextPage(); }} onClose={() => setOpen(null)} storageName={names[items[open]!.storageId]} location={undefined} />)}
    </div>
  );
}

function kindChips(chip: (k: Kind, l: string, n?: number) => React.ReactNode, c?: { image: number; video: number }) {
  return <div role="group" aria-label="Jenis media" className="flex items-center gap-1">{chip("all", "Semua", c ? c.image + c.video : undefined)}{chip("image", "Foto", c?.image)}{chip("video", "Video", c?.video)}</div>;
}
