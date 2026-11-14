import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "./Field";

/** Page buttons around the current page: 1 … 4 [5] 6 … 10. Neighbours are dropped on phones so the row always fits. */
function windowOf(page: number, pages: number): { n: number | "gap"; phoneHidden: boolean }[] {
  const keep = new Set<number>([1, pages, page - 1, page, page + 1]);
  if (page <= 3) for (let i = 1; i <= 4; i++) keep.add(i);
  if (page >= pages - 2) for (let i = pages - 3; i <= pages; i++) keep.add(i);
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((x, y) => x - y);
  const out: { n: number | "gap"; phoneHidden: boolean }[] = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev !== undefined && n - prev === 2) out.push({ n: n - 1, phoneHidden: pages > 5 && n - 1 !== page });
    else if (prev !== undefined && n - prev > 2) out.push({ n: "gap", phoneHidden: false });
    out.push({ n, phoneHidden: pages > 5 && n !== 1 && n !== pages && n !== page });
  });
  return out;
}

/**
 * List footer: "1–10 dari 100 transfer per [10] halaman" and, next to it, « ‹ 1 2 3 … 10 › ». One row on wide screens, two short ones on phones.
 */
export function Pagination({ page, pages, total, noun, onPage, limit, limits = [10, 25, 50, 100], onLimit, pageSize, note, className = "" }: {
  page: number; pages: number; total: number; noun: string; onPage(p: number): void;
  limit?: number; limits?: number[]; onLimit?(n: number): void; pageSize?: number; note?: string; className?: string;
}) {
  const size = limit ?? pageSize ?? 25; const from = total === 0 ? 0 : (page - 1) * size + 1; const to = Math.min(total, page * size);
  const btn = "grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-medium tabular-nums transition-colors pointer-coarse:size-11 disabled:opacity-40";
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-muted", className)}>
      <p className="tnum flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>{from.toLocaleString("id-ID")}–{to.toLocaleString("id-ID")} dari {total.toLocaleString("id-ID")} {noun}{note ?? ""}</span>
        {limit !== undefined && onLimit && (
          <label className="flex items-center gap-1.5 whitespace-nowrap">per
            <Select aria-label="Item per halaman" className="h-8 w-[68px] pr-6 pl-2 text-[12px]" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>{limits.map((n) => <option key={n}>{n}</option>)}</Select>
            halaman</label>
        )}
      </p>
      {pages > 1 && (
        <nav aria-label="Halaman" className="flex items-center gap-0.5 max-sm:mx-auto">
          <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)} className={cn(btn, "hover:bg-surface-2")}><ChevronLeft className="size-4" aria-hidden /></button>
          {windowOf(page, pages).map((x, i) => x.n === "gap"
            ? <span key={`g${i}`} aria-hidden className="grid size-9 place-items-center pointer-coarse:size-11">…</span>
            : <button key={x.n} type="button" aria-label={`Halaman ${x.n}`} aria-current={x.n === page ? "page" : undefined} onClick={() => onPage(x.n as number)} className={cn(btn, x.phoneHidden && "max-sm:hidden", x.n === page ? "bg-primary-soft font-semibold text-primary-ink" : "hover:bg-surface-2 hover:text-ink")}>{x.n}</button>)}
          <button type="button" aria-label="Halaman berikutnya" disabled={page >= pages} onClick={() => onPage(page + 1)} className={cn(btn, "hover:bg-surface-2")}><ChevronRight className="size-4" aria-hidden /></button>
        </nav>
      )}
    </div>
  );
}
