import { Button } from "./Button";
import { Select } from "./Field";

/**
 * List footer. Phones get two tidy rows (count + page size, then Previous · page · Next); wider screens get one row.
 */
export function Pagination({ page, pages, total, noun, onPage, limit, limits = [10, 25, 50, 100], onLimit, note, className = "" }: {
  page: number; pages: number; total: number; noun: string; onPage(p: number): void;
  limit?: number; limits?: number[]; onLimit?(n: number): void; note?: string; className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 text-[12px] text-muted sm:flex ${className}`}>
      <span className="tnum sm:mr-auto">{total.toLocaleString("id-ID")} {noun}{note ?? ""}</span>
      {limit !== undefined && onLimit && (
        <label className="flex items-center gap-1.5 justify-self-end whitespace-nowrap">Per halaman
          <Select aria-label="Per halaman" className="h-8 w-[72px] pr-6 pl-2 text-[12px]" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>{limits.map((n) => <option key={n}>{n}</option>)}</Select>
        </label>
      )}
      <div className="col-span-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</Button>
        <span className="tnum min-w-12 text-center whitespace-nowrap">{page} / {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Berikutnya</Button>
      </div>
    </div>
  );
}
