import type { FileEntry } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { Clock, CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KIND_ICON, KIND_TONE, kindOf } from "@/lib/fileType";
import { useDebounced } from "@/lib/useDebounced";
import { IconButton } from "@/ui/Button";
import { useStorages } from "./Shell";

const RECENT_KEY = "sd-recent-searches";
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : []; } catch { return []; } };
const pushRecent = (q: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 6))); } catch { /* private mode */ } };

/** Name with the matched part in bold, so people see why a suggestion matched. */
function Marked({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "ig"));
  return <>{parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-ink">{p}</b> : <span key={i}>{p}</span>))}</>;
}

type Row = { kind: "item"; e: FileEntry } | { kind: "recent"; q: string } | { kind: "all"; q: string };

function useSearchBox(onDone?: () => void) {
  const nav = useNavigate(); const storages = useStorages().data ?? []; const names = useMemo(() => Object.fromEntries(storages.map((s) => [s.id, s.isDefault ? "Semua file" : s.name])), [storages]);
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const [active, setActive] = useState(-1); const dq = useDebounced(q.trim(), 180);
  const res = useQuery({ queryKey: ["suggest", dq], enabled: dq.length >= 1, staleTime: 15_000, placeholderData: (p) => p, queryFn: () => api<{ items: FileEntry[]; total: number }>(`/search?limit=8&q=${encodeURIComponent(dq)}`) });
  const recent = open && !q.trim() ? readRecent() : [];
  const rows: Row[] = q.trim() ? [...(res.data?.items ?? []).map((e) => ({ kind: "item", e }) as Row), ...(dq ? [{ kind: "all", q: q.trim() } as Row] : [])] : recent.map((r) => ({ kind: "recent", q: r }) as Row);
  useEffect(() => setActive(-1), [dq, open]);
  const full = (text: string) => { const t = text.trim(); if (!t) return; pushRecent(t); setOpen(false); onDone?.(); nav(`/search?q=${encodeURIComponent(t)}`); };
  const pick = (r: Row) => {
    if (r.kind !== "item") return full(r.q);
    const e = r.e; pushRecent(q.trim()); setOpen(false); onDone?.();
    const base = storages.find((s) => s.id === e.storageId)?.isDefault ? "/files" : `/s/${e.storageId}`;
    // A folder opens; a file opens the folder it lives in.
    const target = e.isFolder ? e.id : e.parentId && e.parentId !== "root" ? e.parentId : null;
    nav(target ? `${base}?f=${encodeURIComponent(target)}` : base);
  };
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setOpen(true); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (ev.key === "Enter") { ev.preventDefault(); const r = rows[active]; if (r) pick(r); else full(q); }
    else if (ev.key === "Escape") { if (open) { ev.stopPropagation(); setOpen(false); } }
  };
  return { q, setQ, open, setOpen, active, setActive, rows, pick, full, onKey, names, loading: res.isFetching && !!dq };
}

function Suggestions({ id, s, className }: { id: string; s: ReturnType<typeof useSearchBox>; className?: string }) {
  if (!s.open || (s.rows.length === 0 && !s.q.trim())) return null;
  return (
    <ul id={id} role="listbox" aria-label="Saran pencarian" className={cn("scroll-thin max-h-[min(420px,60dvh)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-float", className)}>
      {!s.q.trim() && <li role="presentation" className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Pencarian terakhir</li>}
      {s.rows.length === 1 && s.rows[0]!.kind === "all" && !s.loading && <li role="presentation" className="px-2.5 py-2 text-[13px] text-muted">Tidak ada file atau folder yang cocok.</li>}
      {s.rows.map((r, i) => {
        const on = i === s.active; const base = "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]";
        if (r.kind === "item") {
          const k = kindOf(r.e); const Icon = KIND_ICON[k]; const where = `${s.names[r.e.storageId] ?? ""}${r.e.path && r.e.path !== "/" ? r.e.path : ""}`;
          return (
            <li key={`${r.e.storageId}:${r.e.id}`} id={`${id}-${i}`} role="option" aria-selected={on} className={cn(base, on ? "bg-primary-soft" : "hover:bg-surface-2")} onMouseEnter={() => s.setActive(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => s.pick(r)}>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", KIND_TONE[k])}><Icon className="size-4" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-muted"><Marked text={r.e.name} q={s.q} /></span><span className="block truncate text-[11px] text-muted" title={where}>{where}</span></span>
              <span className="shrink-0 text-[11px] text-muted">{r.e.isFolder ? "Buka folder" : "Buka lokasi"}</span>
            </li>
          );
        }
        if (r.kind === "recent") return (
          <li key={`r-${r.q}`} id={`${id}-${i}`} role="option" aria-selected={on} className={cn(base, on ? "bg-primary-soft" : "hover:bg-surface-2")} onMouseEnter={() => s.setActive(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => s.pick(r)}>
            <Clock className="size-4 shrink-0 text-muted" aria-hidden /><span className="flex-1 truncate">{r.q}</span>
          </li>);
        return (
          <li key="all" id={`${id}-${i}`} role="option" aria-selected={on} className={cn(base, "border-t border-line", on ? "bg-primary-soft" : "hover:bg-surface-2")} onMouseEnter={() => s.setActive(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => s.pick(r)}>
            <Search className="size-4 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">Cari “<b>{r.q}</b>” di semua penyimpanan</span><CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />
          </li>);
      })}
    </ul>
  );
}

export function GlobalSearch() {
  const id = useId(); const ref = useRef<HTMLInputElement>(null); const mref = useRef<HTMLInputElement>(null); const wrap = useRef<HTMLDivElement>(null); const [sheet, setSheet] = useState(false);
  const d = useSearchBox(); const m = useSearchBox(() => setSheet(false));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (matchMedia("(min-width: 768px)").matches) { ref.current?.focus(); d.setOpen(true); } else setSheet(true); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const c = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) d.setOpen(false); }; addEventListener("mousedown", c); return () => removeEventListener("mousedown", c); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sheet) { m.setOpen(true); mref.current?.focus(); } }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    <div ref={wrap} className="relative hidden md:block">
      <form role="search" onSubmit={(e) => { e.preventDefault(); d.full(d.q); }} className="flex h-9 w-56 items-center gap-2 rounded-lg bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-primary/30 lg:w-72">
        <Search className="size-4 text-faint" aria-hidden />
        <input ref={ref} role="combobox" aria-expanded={d.open} aria-controls={`${id}-d`} aria-autocomplete="list" aria-activedescendant={d.active >= 0 ? `${id}-d-${d.active}` : undefined} aria-label="Cari file" autoComplete="off" value={d.q} onChange={(e) => { d.setQ(e.target.value); d.setOpen(true); }} onFocus={() => d.setOpen(true)} onKeyDown={d.onKey} placeholder="Cari file…" className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-muted focus:outline-none" />
        {d.q ? <button type="button" aria-label="Hapus kata kunci" className="grid size-5 place-items-center rounded text-muted hover:text-ink" onClick={() => { d.setQ(""); ref.current?.focus(); }}><X className="size-3.5" /></button> : <kbd className="text-[11px] text-faint">⌘K</kbd>}
      </form>
      <Suggestions id={`${id}-d`} s={d} className="absolute right-0 z-50 mt-1.5 w-[min(30rem,calc(100vw-2rem))]" />
    </div>
    <IconButton label="Cari file" className="md:hidden" onClick={() => setSheet(true)}><Search className="size-[18px]" /></IconButton>
    {sheet && (
      <div className="fixed inset-0 z-[70] bg-black/40 md:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) setSheet(false); }}>
        <div className="anim-pop border-b border-line bg-surface shadow-float" onKeyDown={(e) => { if (e.key === "Escape") setSheet(false); }}>
          <form role="search" onSubmit={(e) => { e.preventDefault(); m.full(m.q); }} className="flex items-center gap-2 p-3">
            <Search className="ml-1 size-5 shrink-0 text-muted" aria-hidden />
            <input ref={mref} type="search" role="combobox" aria-expanded={m.open} aria-controls={`${id}-m`} aria-autocomplete="list" aria-activedescendant={m.active >= 0 ? `${id}-m-${m.active}` : undefined} enterKeyHint="search" autoComplete="off" value={m.q} onChange={(e) => { m.setQ(e.target.value); m.setOpen(true); }} onKeyDown={m.onKey} aria-label="Cari file" placeholder="Cari nama file di semua penyimpanan" className="h-11 min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-muted focus:outline-none" />
            <IconButton label="Tutup pencarian" onClick={() => setSheet(false)}><X className="size-5" /></IconButton>
          </form>
          <div className="px-2 pb-2"><Suggestions id={`${id}-m`} s={m} className="border-0 shadow-none" /></div>
        </div>
      </div>
    )}
  </>);
}
