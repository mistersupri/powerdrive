import type { FileEntry, StorageConnectionDto } from "@superdrive/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Download, Images, Play, X } from "lucide-react";
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
import { triggerDownload } from "./transferApi";

type Kind = "all" | "image" | "video";
interface Page { items: FileEntry[]; nextCursor: string | null; counts: { image: number; video: number } }
const GAP = 4;

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
  const q = useInfiniteQuery({
    queryKey: ["media", kind, storageId], initialPageParam: "", getNextPageParam: (p: Page) => p.nextCursor ?? undefined, staleTime: 30_000,
    queryFn: ({ pageParam }) => api<Page>(`/media?kind=${kind}&limit=150${storageId ? `&storageId=${storageId}` : ""}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]); const counts = q.data?.pages[0]?.counts;
  const key = (e: FileEntry) => `${e.storageId}:${e.id}`;

  const box = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(360);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const cols = Math.max(3, Math.floor((width + GAP) / (width < 640 ? 112 : 168 + GAP))); const size = Math.floor((width - GAP * (cols - 1)) / cols);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = []; let i = 0;
    while (i < items.length) {
      const label = dayLabel(items[i]!.modifiedAt); let j = i; while (j < items.length && dayLabel(items[j]!.modifiedAt) === label) j++;
      out.push({ key: `h${i}`, kind: "head", label, count: j - i });
      for (let k = i; k < j; k += cols) out.push({ key: `t${k}`, kind: "tiles", items: items.slice(k, Math.min(j, k + cols)) });
      i = j;
    }
    return out;
  }, [items, cols]);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => box.current, estimateSize: (i) => (rows[i]!.kind === "head" ? 48 : size + GAP), overscan: 6, getItemKey: (i) => rows[i]!.key });
  useEffect(() => { virt.measure(); }, [size, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pull the next page in before the end is reached.
  const vi = virt.getVirtualItems(); const lastShown = vi.at(-1)?.index ?? 0;
  useEffect(() => { if (q.hasNextPage && !q.isFetchingNextPage && rows.length - lastShown < 24) void q.fetchNextPage(); }, [lastShown, rows.length, q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (e: FileEntry) => setSel((c) => { const n = new Set(c); const k = key(e); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = items.filter((e) => sel.has(key(e))); const oneStorage = chosen.length > 0 && chosen.every((e) => e.storageId === chosen[0]!.storageId);
  const empty = !q.isLoading && !items.length;
  const chip = (k: Kind, label: string, n?: number) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setSel(new Set()); }} className={cn("h-9 rounded-full px-3.5 text-[13px] font-medium pointer-coarse:h-11", kind === k ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")}>{label}{n !== undefined ? <span className="tnum ml-1.5 text-[12px] opacity-70">{n.toLocaleString("id-ID")}</span> : null}</button>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Media" subtitle="Foto dan video dari semua penyimpanan, terbaru di atas." />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-8">
        {kindChips(chip, counts)}
        <span className="flex-1" />
        {chosen.length > 0 ? (<>
          <span className="tnum inline-flex items-center gap-1 rounded-lg bg-primary-soft py-1 pr-1 pl-2.5 text-[13px] font-medium text-primary-ink">{chosen.length} dipilih<IconButton label="Batal pilih" className="size-6" onClick={() => setSel(new Set())}><X className="size-3.5" /></IconButton></span>
          <Button size="sm" icon={<Download className="size-4" />} disabled={!oneStorage} title={oneStorage ? undefined : "Pilih dari satu penyimpanan untuk mengunduh sekaligus"} onClick={() => triggerDownload(chosen[0]!.storageId, chosen.map((e) => e.id), chosen.length === 1 ? chosen[0]!.name : undefined)}>Unduh{chosen.length > 1 ? " ZIP" : ""}</Button>
        </>) : (
          <Select aria-label="Penyimpanan" value={storageId} onChange={(e) => { setStorageId(e.target.value); setSel(new Set()); }} className="h-9 w-full text-[13px] sm:w-52"><option value="">Semua penyimpanan</option>{storages.filter((s: StorageConnectionDto) => s.status === "CONNECTED").map((s: StorageConnectionDto) => <option key={s.id} value={s.id}>{s.isDefault ? "Semua file" : s.name}</option>)}</Select>)}
      </div>
      <IndexBanner />
      <div ref={box} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-4 pb-24 sm:px-8" role="region" aria-label="Galeri media">
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
      {open !== null && items[open] && (
        <Preview items={items} index={open} onIndex={(i) => { setOpen(i); if (i > items.length - 12 && q.hasNextPage) void q.fetchNextPage(); }} onClose={() => setOpen(null)} storageName={names[items[open]!.storageId]} location={undefined} />)}
    </div>
  );
}

function kindChips(chip: (k: Kind, l: string, n?: number) => React.ReactNode, c?: { image: number; video: number }) {
  return <div role="group" aria-label="Jenis media" className="flex items-center gap-1">{chip("all", "Semua", c ? c.image + c.video : undefined)}{chip("image", "Foto", c?.image)}{chip("video", "Video", c?.video)}</div>;
}
