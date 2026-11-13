import type { FileEntry } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadUrl, previewUrl } from "@/lib/api";
import { kindOf } from "@/lib/fileType";
import { IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/misc";

function TextView({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null); const [cut, setCut] = useState(false);
  useEffect(() => {
    const ac = new AbortController(); setText(null);
    // Only the first 200 KB: previews must stay fast for huge logs.
    fetch(url, { headers: { range: "bytes=0-204799" }, signal: ac.signal }).then(async (r) => { setCut(r.status === 206 && (r.headers.get("content-range") ?? "").split("/")[1] !== String(204800)); setText(await r.text()); }).catch(() => setText("Tidak dapat memuat pratinjau."));
    return () => ac.abort();
  }, [url]);
  if (text === null) return <Spinner className="size-6 text-white/70" />;
  return <div className="max-h-full w-full max-w-4xl overflow-auto rounded-xl bg-surface p-5 text-ink shadow-float scroll-thin"><pre className="font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">{text}</pre>{cut && <p className="mt-3 text-[12px] text-muted">Hanya 200 KB pertama yang ditampilkan.</p>}</div>;
}

/** Full-screen viewer. Media streams from the authorized backend endpoint, never from the provider directly. */
export function Preview({ items, index, onIndex, onClose }: { items: FileEntry[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const f = items[index];
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [index, items.length, onClose, onIndex]);
  if (!f) return null;
  const kind = kindOf(f); const src = previewUrl(f.storageId, f.id);
  return (
    <div className="anim-fade fixed inset-0 z-50 flex flex-col bg-[#0a1222]/95 text-white" role="dialog" aria-modal="true" aria-label={`Pratinjau ${f.name}`}>
      <header className="flex items-center gap-3 px-4 py-3">
        <IconButton label="Tutup" className="text-white hover:bg-white/10 hover:text-white" onClick={onClose}><X className="size-5" /></IconButton>
        <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium">{f.name}</p><p className="tnum text-[12px] text-white/60">{formatBytes(f.size)} · {index + 1} dari {items.length}</p></div>
        <a href={downloadUrl(f.storageId, f.id)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-[13px] font-medium hover:bg-white/20"><Download className="size-4" aria-hidden />Unduh</a>
      </header>
      <div className="relative grid min-h-0 flex-1 place-items-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {kind === "image" && <img key={f.id} src={src} alt={f.name} className="max-h-full max-w-full rounded-lg object-contain" />}
        {kind === "video" && <video key={f.id} src={src} controls autoPlay preload="metadata" className="max-h-full max-w-full rounded-lg bg-black" />}
        {kind === "audio" && <audio key={f.id} src={src} controls autoPlay className="w-full max-w-lg" />}
        {kind === "pdf" && <iframe key={f.id} src={src} title={f.name} className="size-full max-w-5xl rounded-lg bg-white" />}
        {kind === "text" && <TextView key={f.id} url={src} />}
        {index > 0 && <button aria-label="Sebelumnya" onClick={() => onIndex(index - 1)} className="absolute left-3 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronLeft className="size-6" /></button>}
        {index < items.length - 1 && <button aria-label="Berikutnya" onClick={() => onIndex(index + 1)} className="absolute right-3 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronRight className="size-6" /></button>}
      </div>
    </div>
  );
}
