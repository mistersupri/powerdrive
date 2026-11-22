import type { FileEntry } from "@superdrive/shared";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KIND_ICON, KIND_TONE, kindOf } from "@/lib/fileType";
import { useFileUrls } from "./urls";

/** What a folder holds: how many items, and a few of its files to show peeking out of it. */
export interface FolderPeek { count: number; files: FileEntry[] }

const TONES = [
  { back: "#3b78d8", top: "#72a8f6", bottom: "#2f6cd0" },
  { back: "#ec7a38", top: "#ffa86e", bottom: "#ee7b3a" },
  { back: "#2b9d77", top: "#58cba3", bottom: "#23916c" },
  { back: "#7a59d4", top: "#a690f1", bottom: "#6a49c8" },
] as const;
const toneOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return TONES[h % TONES.length]!; };

const SLOTS: Record<number, { left: string; top: string; rot: number }[]> = {
  1: [{ left: "28%", top: "17%", rot: 0 }],
  2: [{ left: "14%", top: "20%", rot: -6 }, { left: "40%", top: "17%", rot: 5 }],
  3: [{ left: "8%", top: "22%", rot: -8 }, { left: "28%", top: "15%", rot: 0 }, { left: "48%", top: "22%", rot: 8 }],
};

function PeekCard({ file, style }: { file: FileEntry; style: React.CSSProperties }) {
  const urls = useFileUrls(); const [bad, setBad] = useState(false);
  const Icon = KIND_ICON[kindOf(file)];
  return (
    <div className="absolute h-[46%] w-[44%] overflow-hidden rounded-md bg-surface shadow-[0_2px_8px_rgb(0_0_0/0.18)] ring-1 ring-black/5" style={style} aria-hidden>
      {file.hasThumbnail && !bad
        ? <img src={urls.thumb(file, 128)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} className="size-full object-cover" />
        : <div className={cn("flex size-full flex-col items-center justify-center gap-0.5 px-1", KIND_TONE[kindOf(file)])}><Icon className="size-1/3 min-h-3 min-w-3" strokeWidth={1.6} /><span className="w-full truncate text-center text-[9px] leading-none">{file.name}</span></div>}
    </div>
  );
}

/** A folder drawn like a real one: a back panel, a few files peeking out, and a front panel with the item count. */
export function FolderArt({ id, peek }: { id: string; peek?: FolderPeek }) {
  const tone = toneOf(id); const files = (peek?.files ?? []).slice(0, 3); const slots = SLOTS[files.length] ?? [];
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="absolute top-[11%] left-[8%] h-[14%] w-[36%] rounded-t-lg" style={{ background: tone.back }} />
      <div className="absolute inset-x-[8%] top-[18%] bottom-[8%] rounded-xl" style={{ background: tone.back }} />
      {files.map((f, i) => <PeekCard key={f.id} file={f} style={{ left: slots[i]!.left, top: slots[i]!.top, transform: `rotate(${slots[i]!.rot}deg)` }} />)}
      <div className="absolute inset-x-[8%] bottom-[8%] flex h-[54%] items-end rounded-xl p-[5%] shadow-[0_-2px_10px_rgb(0_0_0/0.12)]" style={{ background: `linear-gradient(180deg, ${tone.top}, ${tone.bottom})` }}>
        {peek && peek.count > 0 && <span className="tnum text-[11px] font-medium text-white/90 sm:text-[12px]">{peek.count.toLocaleString("id-ID")} item</span>}
      </div>
    </div>
  );
}

/**
 * Looks inside the folders on screen with one request per storage (public share pages have no such request).
 * Keys are `storageId/folderId`.
 */
export function useFolderPeeks(folders: FileEntry[]): Record<string, FolderPeek> {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of folders) { if (f.storageId === "share") continue; const l = m.get(f.storageId) ?? []; l.push(f.id); m.set(f.storageId, l); }
    return [...m].map(([storageId, ids]) => ({ storageId, ids: ids.slice(0, 200) }));
  }, [folders]);
  const res = useQueries({
    queries: groups.map((g) => ({
      queryKey: ["folder-peeks", g.storageId, g.ids.join(",")], staleTime: 30_000, placeholderData: keepPreviousData,
      queryFn: () => api<{ items: Record<string, FolderPeek> }>("/files/folder-previews", { body: { storageId: g.storageId, ids: g.ids } }).then((r) => r.items),
    })),
  });
  const stamp = res.map((r) => r.dataUpdatedAt).join(",");
  return useMemo(() => {
    const out: Record<string, FolderPeek> = {};
    res.forEach((r, i) => { for (const [id, v] of Object.entries(r.data ?? {})) out[`${groups[i]!.storageId}/${id}`] = v; });
    return out;
  }, [stamp, groups]); // eslint-disable-line react-hooks/exhaustive-deps
}
