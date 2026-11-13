import type { FileEntry } from "@superdrive/shared";
import { ChevronLeft, ChevronRight, Maximize, Minimize, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFileUrls } from "@/features/files/urls";

const SPEEDS = [3, 5, 8, 15] as const;

/** Full-screen slideshow over the images of the current folder. Space pauses, arrows move, Esc closes. */
export function Slideshow({ items, start, onClose }: { items: FileEntry[]; start: number; onClose(): void }) {
  const urls = useFileUrls(); const root = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start); const [playing, setPlaying] = useState(true); const [secs, setSecs] = useState<number>(5); const [chrome, setChrome] = useState(true); const [full, setFull] = useState(false);
  const n = items.length; const f = items[i];
  const step = useCallback((d: number) => setI((x) => (x + d + n) % n), [n]);
  useEffect(() => { if (!playing || n < 2) return; const t = setTimeout(() => step(1), secs * 1000); return () => clearTimeout(t); }, [playing, secs, i, n, step]);
  // Warm the next image so the switch is instant.
  useEffect(() => { if (n < 2) return; const im = new Image(); im.src = urls.preview(items[(i + 1) % n]!); }, [i, items, n, urls]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); } else if (e.key.toLowerCase() === "f") toggleFull();
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const c = () => setFull(!!document.fullscreenElement); document.addEventListener("fullscreenchange", c); return () => { document.removeEventListener("fullscreenchange", c); if (document.fullscreenElement) void document.exitFullscreen(); }; }, []);
  // Hide the controls after a moment of no mouse movement.
  useEffect(() => { let t: ReturnType<typeof setTimeout>; const show = () => { setChrome(true); clearTimeout(t); t = setTimeout(() => setChrome(false), 2500); }; show(); addEventListener("mousemove", show); addEventListener("keydown", show); return () => { clearTimeout(t); removeEventListener("mousemove", show); removeEventListener("keydown", show); }; }, []);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => {}); };
  useEffect(() => { root.current?.focus(); void root.current?.requestFullscreen?.().catch(() => {}); }, []);
  if (!f) return null;
  const bar = "absolute inset-x-0 flex items-center gap-2 px-4 py-3 text-white transition-opacity duration-300 " + (chrome ? "opacity-100" : "pointer-events-none opacity-0");
  const btn = "grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white";
  return (
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Tayangan slide" className="fixed inset-0 z-[60] bg-black focus:outline-none" style={{ cursor: chrome ? "default" : "none" }}>
      <img key={f.id} src={urls.preview(f)} alt={f.name} className="anim-fade absolute inset-0 size-full object-contain" draggable={false} />
      <div className={bar + " top-0 bg-gradient-to-b from-black/70 to-transparent"}>
        <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{f.name} <span className="tnum ml-2 text-white/60">{i + 1} / {n}</span></p>
        <button className={btn} aria-label={full ? "Keluar layar penuh" : "Layar penuh"} onClick={toggleFull}>{full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</button>
        <button className={btn} aria-label="Tutup tayangan slide" onClick={onClose}><X className="size-5" /></button>
      </div>
      {n > 1 && <>
        <button className={btn + " absolute top-1/2 left-4 -translate-y-1/2 transition-opacity " + (chrome ? "" : "opacity-0")} aria-label="Sebelumnya" onClick={() => step(-1)}><ChevronLeft className="size-6" /></button>
        <button className={btn + " absolute top-1/2 right-4 -translate-y-1/2 transition-opacity " + (chrome ? "" : "opacity-0")} aria-label="Berikutnya" onClick={() => step(1)}><ChevronRight className="size-6" /></button>
      </>}
      <div className={bar + " bottom-0 justify-center bg-gradient-to-t from-black/70 to-transparent"}>
        <button className={btn} aria-label={playing ? "Jeda" : "Putar"} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="size-5" /> : <Play className="size-5" />}</button>
        <label className="flex items-center gap-2 text-[13px]">Jeda antar slide
          <select aria-label="Jeda antar slide" className="h-9 rounded-lg bg-white/15 px-2 text-white" value={secs} onChange={(e) => setSecs(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s} className="text-black">{s} dtk</option>)}</select></label>
      </div>
      {playing && n > 1 && <div key={`${f.id}-${secs}`} className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-white/70" style={{ animation: `sd-progress ${secs}s linear forwards` }} />}
      <style>{`@keyframes sd-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}`}</style>
    </div>
  );
}
