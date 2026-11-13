import { ArrowDownAZ, ArrowUpAZ, Grid2x2, List } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMenu } from "@/ui/Menu";
import type { SortKey, SortState } from "./useFolder";

const SORT_LABEL: Record<SortKey, string> = { name: "Nama", size: "Ukuran", modified: "Terakhir diubah", type: "Jenis" };

export function SortViewControls({ sort, setSort, view, setView }: { sort: SortState; setSort(s: SortState): void; view: "grid" | "list"; setView(v: "grid" | "list"): void }) {
  const menu = useMenu();
  return (
    <div className="flex items-center gap-1">
      <button className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-ink" aria-haspopup="menu"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu.open(r.left, r.bottom + 4, (Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ label: SORT_LABEL[k] + (sort.key === k ? (sort.dir === "asc" ? "  ↑" : "  ↓") : ""), onSelect: () => setSort({ key: k, dir: sort.key === k && sort.dir === "asc" ? "desc" : "asc" }) }))); }}>
        {sort.dir === "asc" ? <ArrowDownAZ className="size-4" /> : <ArrowUpAZ className="size-4" />}<span className="hidden sm:inline">{SORT_LABEL[sort.key]}</span>
      </button>
      <div className="flex rounded-lg bg-surface-2 p-0.5" role="group" aria-label="Tampilan">
        {([["grid", Grid2x2, "Tampilan kisi"], ["list", List, "Tampilan daftar"]] as const).map(([v, I, l]) => (
          <button key={v} aria-label={l} title={l} aria-pressed={view === v} onClick={() => setView(v)} className={cn("grid size-8 place-items-center rounded-md text-muted transition-colors", view === v && "bg-surface text-ink shadow-card")}><I className="size-4" /></button>
        ))}
      </div>
      {menu.element}
    </div>
  );
}
