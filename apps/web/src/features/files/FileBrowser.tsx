import type { FileEntry } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, MoreVertical, Star } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { KIND_ICON, KIND_TONE, kindOf } from "@/lib/fileType";
import { shortDate } from "@/lib/format";
import { Skeleton } from "@/ui/misc";
import { DRAG_MIME, collectDropped, hasFiles, setActiveDrag, activeDrag } from "./dnd";
import { FileThumb } from "./FileThumb";
import { prefetchFolder } from "./useFolder";
import type { UploadInput } from "@/features/uploads/manager";

export interface BrowserProps {
  entries: FileEntry[];
  view: "grid" | "list";
  selected: Set<string>;
  loading?: boolean;
  empty?: ReactNode;
  storageNames?: Record<string, string>;
  compact?: boolean;
  onSelect(e: FileEntry, mods: { shift: boolean; additive: boolean }): void;
  onOpen(e: FileEntry): void;
  onContext(e: FileEntry | null, x: number, y: number): void;
  onKeyAction(action: "selectAll" | "delete" | "rename" | "clear"): void;
  /** Items dragged from inside the app, or files dragged from the OS, were dropped on `target` (null = this folder). */
  onDropItems(target: FileEntry | null, payload: { storageId: string; ids: string[] }, copy: boolean): void;
  onDropFiles(target: FileEntry | null, files: UploadInput[]): void;
  dropLabel?: string;
}

const useWidth = (ref: React.RefObject<HTMLElement | null>) => {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, [ref]);
  return w;
};

type Row = { key: string; h: number; node: (w: number) => ReactNode };
const GAP = 12;

export function FileBrowser(p: BrowserProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = useWidth(scroller) - (p.compact ? 24 : 48);
  const [cursor, setCursor] = useState(-1);
  const [dropTarget, setDropTarget] = useState<string | "__pane" | null>(null);
  const dragDepth = useRef(0);

  const folders = useMemo(() => p.entries.filter((e) => e.isFolder), [p.entries]);
  const files = useMemo(() => p.entries.filter((e) => !e.isFolder), [p.entries]);

  const dropHandlers = (target: FileEntry | null) => ({
    onDragOver: (ev: React.DragEvent) => {
      const internal = ev.dataTransfer.types.includes(DRAG_MIME);
      if (!internal && !hasFiles(ev.dataTransfer)) return;
      if (target && !target.isFolder) return;
      if (internal && target && activeDrag?.ids.includes(target.id)) return; // not onto itself
      ev.preventDefault(); ev.stopPropagation();
      ev.dataTransfer.dropEffect = ev.altKey ? "copy" : internal ? "move" : "copy";
      setDropTarget(target ? target.id : "__pane");
    },
    onDragLeave: (ev: React.DragEvent) => { ev.stopPropagation(); if (target) setDropTarget((c) => (c === target.id ? null : c)); },
    onDrop: async (ev: React.DragEvent) => {
      if (target && !target.isFolder) return;
      ev.preventDefault(); ev.stopPropagation(); setDropTarget(null); dragDepth.current = 0;
      const raw = ev.dataTransfer.getData(DRAG_MIME);
      if (raw) { p.onDropItems(target, JSON.parse(raw), ev.altKey); setActiveDrag(null); }
      else if (hasFiles(ev.dataTransfer)) p.onDropFiles(target, await collectDropped(ev.dataTransfer));
    },
  });

  const itemProps = (e: FileEntry, index: number) => ({
    role: "option" as const, "aria-selected": p.selected.has(e.id), "data-id": e.id, tabIndex: -1,
    draggable: true,
    onDragStart: (ev: React.DragEvent) => {
      const ids = p.selected.has(e.id) ? [...p.selected] : [e.id];
      const payload = { storageId: e.storageId, ids, names: ids.map((i) => p.entries.find((x) => x.id === i)?.name ?? "") };
      ev.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload)); ev.dataTransfer.effectAllowed = "copyMove";
      setActiveDrag(payload);
      if (!p.selected.has(e.id)) p.onSelect(e, { shift: false, additive: false });
    },
    onDragEnd: () => setActiveDrag(null),
    onClick: (ev: React.MouseEvent) => {
      setCursor(index);
      const touch = (ev.nativeEvent as PointerEvent).pointerType === "touch";
      if (touch && p.selected.size === 0 && !(ev.target as HTMLElement).closest("[data-check]")) return p.onOpen(e);
      p.onSelect(e, { shift: ev.shiftKey, additive: ev.metaKey || ev.ctrlKey || touch || !!(ev.target as HTMLElement).closest("[data-check]") });
    },
    onDoubleClick: () => p.onOpen(e),
    onContextMenu: (ev: React.MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); if (!p.selected.has(e.id)) p.onSelect(e, { shift: false, additive: false }); p.onContext(e, ev.clientX, ev.clientY); },
    onPointerEnter: e.isFolder ? () => prefetchFolder(e.storageId, e.id) : undefined,
    ...(e.isFolder ? dropHandlers(e) : {}),
  });

  const ordered = useMemo(() => [...folders, ...files], [folders, files]);
  const idx = useMemo(() => new Map(ordered.map((e, i) => [e.id, i])), [ordered]);

  const rowOf = useMemo(() => new Map<string, number>(), []);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    rowOf.clear();
    if (p.view === "list") {
      out.push({ key: "hdr", h: 36, node: () => <ListHeader showStorage={!!p.storageNames} compact={p.compact} /> });
      ordered.forEach((e, i) => { rowOf.set(e.id, out.length); out.push({ key: e.id, h: 52, node: () => <ListRow e={e} i={i} sel={p.selected.has(e.id)} drop={dropTarget === e.id} cursor={cursor === i} props={itemProps(e, i)} storageName={p.storageNames?.[e.storageId]} compact={p.compact} onMenu={(x, y) => p.onContext(e, x, y)} /> }); });
      return out;
    }
    const fCols = Math.max(1, Math.floor((width + GAP) / (p.compact ? 200 : 236 + GAP)));
    const cols = Math.max(2, Math.floor((width + GAP) / ((p.compact ? 132 : 176) + GAP)));
    const tileW = (width - GAP * (cols - 1)) / cols; const tileH = Math.round(tileW * 0.74) + 54;
    if (folders.length) {
      out.push({ key: "lbl-f", h: 30, node: () => <SectionLabel>Folder · {folders.length}</SectionLabel> });
      for (let i = 0; i < folders.length; i += fCols) {
        const chunk = folders.slice(i, i + fCols); chunk.forEach((e) => rowOf.set(e.id, out.length));
        out.push({ key: `f${i}`, h: 52 + GAP, node: () => <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${fCols}, minmax(0, 1fr))` }}>{chunk.map((e) => <FolderChip key={e.id} e={e} sel={p.selected.has(e.id)} drop={dropTarget === e.id} props={itemProps(e, idx.get(e.id)!)} onMenu={(x, y) => p.onContext(e, x, y)} />)}</div> });
      }
    }
    if (files.length) {
      out.push({ key: "lbl-d", h: 30, node: () => <SectionLabel>File · {files.length}</SectionLabel> });
      for (let i = 0; i < files.length; i += cols) {
        const chunk = files.slice(i, i + cols); chunk.forEach((e) => rowOf.set(e.id, out.length));
        out.push({ key: `d${i}`, h: tileH + GAP, node: () => <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{chunk.map((e) => <FileTile key={e.id} e={e} sel={p.selected.has(e.id)} cursor={cursor === idx.get(e.id)} props={itemProps(e, idx.get(e.id)!)} onMenu={(x, y) => p.onContext(e, x, y)} />)}</div> });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.view, p.entries, p.selected, width, dropTarget, cursor, p.storageNames, p.compact]);

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: (i) => rows[i]!.h, overscan: 6, getItemKey: (i) => rows[i]!.key });
  useEffect(() => { virt.measure(); }, [rows.length, p.view, width]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback((d: number) => {
    const n = Math.max(0, Math.min(ordered.length - 1, (cursor < 0 ? 0 : cursor) + d)); setCursor(n);
    const e = ordered[n]; if (e) { p.onSelect(e, { shift: false, additive: false }); const r = rowOf.get(e.id); if (r !== undefined) virt.scrollToIndex(r, { align: "auto" }); }
  }, [cursor, ordered, p, rowOf, virt]);

  const onKey = (ev: React.KeyboardEvent) => {
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "a") { ev.preventDefault(); p.onKeyAction("selectAll"); }
    else if (ev.key === "Escape") p.onKeyAction("clear");
    else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); p.onKeyAction("delete"); }
    else if (ev.key === "F2") p.onKeyAction("rename");
    else if (ev.key === "Enter" && ordered[cursor]) p.onOpen(ordered[cursor]!);
    else if (ev.key === "ArrowDown") { ev.preventDefault(); move(p.view === "list" ? 1 : Math.max(1, Math.floor((width + GAP) / 188))); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); move(p.view === "list" ? -1 : -Math.max(1, Math.floor((width + GAP) / 188))); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); move(1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); move(-1); }
  };

  const pane = dropHandlers(null);
  return (
    <div
      ref={scroller} tabIndex={0} role="listbox" aria-multiselectable aria-label="Daftar file" onKeyDown={onKey}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg) p.onKeyAction("clear"); }}
      onContextMenu={(e) => { if (!(e.target as HTMLElement).closest("[role=option]")) { e.preventDefault(); p.onContext(null, e.clientX, e.clientY); } }}
      {...pane}
      className={cn("scroll-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none", p.compact ? "px-3 pb-6" : "px-4 pb-24 sm:px-6", dropTarget === "__pane" && "bg-primary-soft/60 ring-2 ring-primary ring-inset")}
    >
      {p.loading ? <BrowserSkeleton view={p.view} /> : p.entries.length === 0 ? p.empty : (
        <div style={{ height: virt.getTotalSize(), position: "relative" }} data-bg="1">
          {virt.getVirtualItems().map((v) => (
            <div key={v.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: v.size, transform: `translateY(${v.start}px)` }} data-bg="1">{rows[v.index]!.node(width)}</div>
          ))}
        </div>)}
      {dropTarget === "__pane" && <div className="pointer-events-none sticky bottom-4 mx-auto w-fit rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-white shadow-float">{p.dropLabel ?? "Lepaskan di sini"}</div>}
    </div>
  );
}

const SectionLabel = ({ children }: { children: ReactNode }) => <h3 className="pt-3 pb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase" data-bg="1">{children}</h3>;

const Check1 = ({ on }: { on: boolean }) => (
  <span data-check="1" className={cn("grid size-[22px] place-items-center rounded-md border transition-colors", on ? "border-primary bg-primary text-white" : "border-line-strong bg-surface/90 text-transparent hover:border-primary")}>
    <Check className="size-3.5" strokeWidth={3} aria-hidden />
  </span>
);

const FolderChip = memo(function FolderChip({ e, sel, drop, props, onMenu }: { e: FileEntry; sel: boolean; drop: boolean; props: any; onMenu(x: number, y: number): void }) {
  const Icon = KIND_ICON.folder;
  return (
    <div {...props} className={cn("group flex h-[52px] cursor-default items-center gap-3 rounded-xl border bg-surface px-3 transition-colors select-none", sel ? "border-primary bg-primary-soft" : "border-line hover:border-line-strong hover:bg-surface-2", drop && "border-primary bg-primary-soft ring-2 ring-primary")}>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", KIND_TONE.folder)}><Icon className="size-[18px]" fill="currentColor" fillOpacity={0.15} aria-hidden /></span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={e.name}>{e.name}</span>
      {e.starred && <Star className="size-3.5 shrink-0 fill-warn-ink text-warn-ink" aria-label="Berbintang" />}
      <button aria-label={`Menu untuk ${e.name}`} className="grid size-7 place-items-center rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-surface focus:opacity-100 pointer-coarse:opacity-100" onClick={(ev) => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); onMenu(r.right - 200, r.bottom); }}><MoreVertical className="size-4" /></button>
    </div>
  );
});

const FileTile = memo(function FileTile({ e, sel, cursor, props, onMenu }: { e: FileEntry; sel: boolean; cursor: boolean; props: any; onMenu(x: number, y: number): void }) {
  const kind = kindOf(e); const Icon = KIND_ICON[kind];
  return (
    <div {...props} className={cn("group relative flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors select-none", sel ? "border-primary ring-2 ring-primary/40" : "border-line hover:border-line-strong", cursor && !sel && "ring-2 ring-primary/20")}>
      <FileThumb file={e} size={256} className="aspect-[4/3] w-full bg-surface-2" />
      <span className={cn("absolute top-2 left-2 transition-opacity", sel ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100")}><Check1 on={sel} /></span>
      <button aria-label={`Menu untuk ${e.name}`} className="absolute top-2 right-2 grid size-7 place-items-center rounded-md bg-surface/90 text-muted opacity-0 shadow-card group-hover:opacity-100 hover:text-ink focus:opacity-100 pointer-coarse:opacity-100" onClick={(ev) => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); onMenu(r.right - 200, r.bottom); }}><MoreVertical className="size-4" /></button>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium" title={e.name}>{e.name}</div><div className="tnum text-[11px] text-muted">{formatBytes(e.size)} · {shortDate(e.modifiedAt)}</div></div>
        {e.starred && <Star className="size-3.5 shrink-0 fill-warn-ink text-warn-ink" aria-label="Berbintang" />}
      </div>
    </div>
  );
});

const COLS = "grid-cols-[28px_minmax(0,1fr)_88px_120px_32px] md:grid-cols-[28px_minmax(0,1fr)_100px_88px_128px_32px]";
function ListHeader({ showStorage, compact }: { showStorage: boolean; compact?: boolean }) {
  return <div className={cn("grid items-center gap-3 border-b border-line px-3 text-[12px] font-semibold text-muted", COLS, compact && "!grid-cols-[28px_minmax(0,1fr)_72px_32px]")} data-bg="1"><span /><span>Nama</span><span className="hidden md:block">{showStorage ? "Penyimpanan" : "Jenis"}</span><span className={cn("text-right", compact && "hidden")}>Ukuran</span><span className={cn("hidden md:block", compact && "!hidden")}>Diubah</span><span /></div>;
}
const ListRow = memo(function ListRow({ e, sel, drop, cursor, props, storageName, compact, onMenu }: { e: FileEntry; i: number; sel: boolean; drop: boolean; cursor: boolean; props: any; storageName?: string; compact?: boolean; onMenu(x: number, y: number): void }) {
  const kind = kindOf(e);
  return (
    <div {...props} className={cn("group grid h-[52px] items-center gap-3 border-b border-line px-3 text-[13px] select-none", COLS, compact && "!grid-cols-[28px_minmax(0,1fr)_72px_32px]", sel ? "bg-primary-soft" : "hover:bg-surface-2", cursor && !sel && "bg-surface-2", drop && "bg-primary-soft ring-2 ring-primary ring-inset")}>
      <span className="relative"><FileThumb file={e} size={128} className="size-7 rounded-md" iconClass="size-4" />{sel && <span className="absolute -top-1 -left-1 grid size-3.5 place-items-center rounded-full bg-primary text-white"><Check className="size-2.5" strokeWidth={3.5} /></span>}</span>
      <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium" title={e.name}>{e.name}</span>{e.starred && <Star className="size-3.5 shrink-0 fill-warn-ink text-warn-ink" aria-label="Berbintang" />}</span>
      <span className="hidden truncate text-muted md:block">{storageName ?? (e.isFolder ? "Folder" : (e.name.split(".").pop() || kind).toUpperCase())}</span>
      <span className={cn("tnum text-right text-muted", compact && "hidden")}>{e.isFolder ? "—" : formatBytes(e.size)}</span>
      {compact && <span className="tnum text-right text-muted">{e.isFolder ? "—" : formatBytes(e.size)}</span>}
      <span className={cn("tnum hidden text-muted md:block", compact && "!hidden")}>{shortDate(e.modifiedAt)}</span>
      <button aria-label={`Menu untuk ${e.name}`} className="grid size-7 place-items-center rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-surface focus:opacity-100 pointer-coarse:opacity-100" onClick={(ev) => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); onMenu(r.right - 200, r.bottom); }}><MoreVertical className="size-4" /></button>
    </div>
  );
});

function BrowserSkeleton({ view }: { view: "grid" | "list" }) {
  return view === "grid"
    ? <div className="grid gap-3 pt-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }} aria-busy>{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-[190px] rounded-xl" />)}</div>
    : <div className="space-y-px pt-10" aria-busy>{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[52px] rounded-none" />)}</div>;
}
