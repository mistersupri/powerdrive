import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "./Field";

/** Page buttons around the current page: 1 … 4 [5] 6 … 10. Phones show "2 / 5" instead, so the footer stays on one row. */
function windowOf(page: number, pages: number): { n: number | "gap" }[] {
  const keep = new Set<number>([1, pages, page - 1, page, page + 1]);
  if (page <= 3) for (let i = 1; i <= 4; i++) keep.add(i);
  if (page >= pages - 2) for (let i = pages - 3; i <= pages; i++) keep.add(i);
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((x, y) => x - y);
  const out: { n: number | "gap" }[] = [];
  nums.forEach((n, i) => {
    const prev = nums[i - 1];
    if (prev !== undefined && n - prev === 2) out.push({ n: n - 1 });
    else if (prev !== undefined && n - prev > 2) out.push({ n: "gap" });
    out.push({ n });
  });
  return out;
}

/**
 * List footer in three parts on one row: "1–10 dari 100" on the left, « ‹ 1 2 3 … 10 › » in the middle, "limit: [10]" on the right.
 * On phones the page buttons drop to their own centred row underneath.
 */
export function Pagination({ page, pages, total, noun, onPage, limit, limits = [10, 25, 50, 100], onLimit, pageSize, note, className = "" }: {
  page: number; pages: number; total: number; noun: string; onPage(p: number): void;
  limit?: number; limits?: number[]; onLimit?(n: number): void; pageSize?: number; note?: string; className?: string;
}) {
  const size = limit ?? pageSize ?? 25; const from = total === 0 ? 0 : (page - 1) * size + 1; const to = Math.min(total, page * size);
  const btn = "grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-medium tabular-nums transition-colors pointer-coarse:size-11 disabled:opacity-40";
  return (
    <div className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-2 text-[12px] text-muted sm:grid-cols-[1fr_auto_1fr] sm:gap-x-4", className)}>
      <p className="tnum">{from.toLocaleString("id-ID")}–{to.toLocaleString("id-ID")} dari {total.toLocaleString("id-ID")}<span className="sr-only"> {noun}</span>{note ?? ""}</p>
      {pages > 1 ? (
        <nav aria-label="Halaman" className="col-start-2 flex items-center justify-center gap-0.5">
          <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)} className={cn(btn, "hover:bg-surface-2")}><ChevronLeft className="size-4" aria-hidden /></button>
          <span className="tnum min-w-12 px-0.5 text-center text-[13px] font-medium text-ink sm:hidden" aria-label={`Halaman ${page} dari ${pages}`}>{page} / {pages}</span>
          {windowOf(page, pages).map((x, i) => x.n === "gap"
            ? <span key={`g${i}`} aria-hidden className="grid size-9 place-items-center pointer-coarse:size-11 max-sm:hidden">…</span>
            : <button key={x.n} type="button" aria-label={`Halaman ${x.n}`} aria-current={x.n === page ? "page" : undefined} onClick={() => onPage(x.n as number)} className={cn(btn, "max-sm:hidden", x.n === page ? "bg-primary-soft font-semibold text-primary-ink" : "hover:bg-surface-2 hover:text-ink")}>{x.n}</button>)}
          <button type="button" aria-label="Halaman berikutnya" disabled={page >= pages} onClick={() => onPage(page + 1)} className={cn(btn, "hover:bg-surface-2")}><ChevronRight className="size-4" aria-hidden /></button>
        </nav>
      ) : <span />}
      {limit !== undefined && onLimit ? (
        <label className="col-start-3 flex items-center gap-1.5 justify-self-end whitespace-nowrap"><span className="max-[360px]:sr-only">limit:</span>
          <Select aria-label="Item per halaman" className="h-8 w-[72px] pr-5 pl-2 text-[12px] sm:w-[72px]" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>{limits.map((n) => <option key={n}>{n}</option>)}</Select>
        </label>
      ) : <span />}
    </div>
  );
}
