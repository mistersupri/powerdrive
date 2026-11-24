import type { FileEntry } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePersistentState } from "@/lib/usePersistentState";
import { FileThumb } from "./FileThumb";

export interface HighlightGroup { year: number; yearsAgo: number; total: number; items: FileEntry[] }
const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const short = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });

/** "Sorotan": photos and videos from earlier years taken today or in the next three days. Hidden when there is nothing to remember. */
export function HighlightsStrip({ storageId = "", onOpen }: { storageId?: string; onOpen(items: FileEntry[]): void }) {
  const today = localDate(); const tz = -new Date().getTimezoneOffset();
  const q = useQuery({ queryKey: ["media-highlights", today, tz, storageId], queryFn: () => api<{ groups: HighlightGroup[] }>(`/media/highlights?date=${today}&tz=${tz}${storageId ? `&storageId=${storageId}` : ""}`), staleTime: 10 * 60_000 });
  const [open, setOpen] = usePersistentState<boolean>("sd-highlights", true);
  const groups = q.data?.groups ?? []; if (!groups.length) return null;
  const from = new Date(); const until = new Date(from.getTime() + 3 * 86_400_000);
  return (
    <section aria-label="Sorotan" className="border-b border-line bg-surface px-4 py-2 sm:px-8">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-primary-ink" aria-hidden />
        <h2 className="text-[13px] font-semibold">Sorotan</h2>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{short(from)} – {short(until)} di tahun-tahun lalu</span>
        <button type="button" aria-expanded={open} aria-label={open ? "Ciutkan sorotan" : "Buka sorotan"} onClick={() => setOpen(!open)} className="press grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 pointer-coarse:size-11"><ChevronDown className={cn("size-4 transition-transform duration-200", !open && "-rotate-90")} /></button>
      </div>
      {open && (
        <ul className="scroll-thin -mx-1 mt-2 flex gap-2.5 overflow-x-auto px-1 pb-2">
          {groups.map((g) => (
            <li key={g.year} className="shrink-0">
              <button type="button" onClick={() => onOpen(g.items)} className="press group block w-[116px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-[132px]" aria-label={`${g.yearsAgo} tahun lalu, ${g.total} item`}>
                <span className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
                  <FileThumb file={g.items[0]!} size={256} className="size-full" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-white"><span className="block text-[13px] leading-tight font-semibold">{g.yearsAgo} tahun lalu</span><span className="tnum block text-[11px] opacity-85">{g.year} · {g.total} item</span></span>
                </span>
              </button>
            </li>))}
        </ul>)}
    </section>
  );
}
