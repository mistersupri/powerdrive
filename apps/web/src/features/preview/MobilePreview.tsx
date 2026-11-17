import type { FileEntry } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Info, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { startDownload } from "@/lib/download";
import { previewKind } from "@/lib/fileType";
import { DetailsPanel } from "@/features/files/DetailsPanel";
import { useFileUrls } from "@/features/files/urls";
import { Presence } from "@/ui/Presence";
import type { PreviewProps } from "./Preview";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const EASE = "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)";
interface Fullscreen { setFullscreen?(on: boolean): void }
const bridge = () => (window as unknown as { SuperDriveAndroid?: Fullscreen }).SuperDriveAndroid;

/**
 * The previewer of the Android app: edge to edge on black, like a phone's gallery.
 * Swipe sideways to change photo, pinch or double-tap to zoom, drag down to close, tap to hide the bars.
 * Videos use the same player (it fills the screen); documents get a plain full-screen page.
 */
export function MobilePreview({ items, index, onIndex, onClose, onShare, canDownload = true, location, storageName, extras = true, viewer }: PreviewProps & { viewer: (f: FileEntry) => ReactNode }) {
  const f = items[index]; const urls = useFileUrls();
  const [chrome, setChrome] = useState(true); const [info, setInfo] = useState(false); const [hi, setHi] = useState(false);
  const root = useRef<HTMLDivElement>(null); const track = useRef<HTMLDivElement>(null); const bg = useRef<HTMLDivElement>(null); const img = useRef<HTMLImageElement | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const z = useRef({ s: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ mode: "none" as "none" | "pan" | "pinch" | "page" | "dismiss" | "ignore", sx: 0, sy: 0, st: 0, dx: 0, dy: 0, z0: { s: 1, x: 0, y: 0 }, d0: 1, c0: { x: 0, y: 0 }, lastTap: 0, tapX: 0, tapY: 0, tapTimer: 0 as unknown as ReturnType<typeof setTimeout> });
  const kind = f ? previewKind(f) : "text"; const gestures = kind === "image";

  /* the Android back button / a swipe-back closes the viewer instead of leaving the page */
  useEffect(() => {
    history.pushState({ sdPreview: true }, ""); let popped = false;
    const pop = () => { popped = true; closeRef.current(); };
    addEventListener("popstate", pop);
    return () => { removeEventListener("popstate", pop); if (!popped && (history.state as { sdPreview?: boolean } | null)?.sdPreview) history.back(); };
  }, []);
  /* system bars follow the viewer's bars: hidden together, so the picture really is full screen */
  useEffect(() => { bridge()?.setFullscreen?.(!chrome && gestures); }, [chrome, gestures]);
  useEffect(() => () => bridge()?.setFullscreen?.(false), []);
  useEffect(() => { z.current = { s: 1, x: 0, y: 0 }; setHi(false); setInfo(false); setChrome(true); }, [index]);

  if (!f) return null;
  const w = () => root.current?.clientWidth ?? innerWidth; const h = () => root.current?.clientHeight ?? innerHeight;
  const paint = () => { if (img.current) img.current.style.transform = `translate3d(${z.current.x}px, ${z.current.y}px, 0) scale(${z.current.s})`; };
  const limit = () => { const s = z.current.s; const mx = ((s - 1) * w()) / 2; const my = ((s - 1) * h()) / 2; z.current.x = clamp(z.current.x, -mx, mx); z.current.y = clamp(z.current.y, -my, my); };
  const glide = (el: HTMLElement | null, to: string, done?: () => void) => {
    if (!el) return done?.(); el.style.transition = EASE; el.style.transform = to;
    const end = () => { el.style.transition = ""; done?.(); }; setTimeout(end, 290);
  };
  const zoomTo = (s: number, cx: number, cy: number, animate = true) => {
    const r = root.current!.getBoundingClientRect(); const px = cx - r.left - r.width / 2; const py = cy - r.top - r.height / 2; const k = s / z.current.s;
    z.current = { s, x: px - (px - z.current.x) * k, y: py - (py - z.current.y) * k }; if (s <= 1) z.current = { s: 1, x: 0, y: 0 }; limit();
    if (s > 1.5) setHi(true);
    if (animate && img.current) { img.current.style.transition = EASE; paint(); setTimeout(() => { if (img.current) img.current.style.transition = ""; }, 290); } else paint();
  };
  const go = (to: number) => { if (to >= 0 && to < items.length) onIndex(to); };
  const dist = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  const center = () => { const [a, b] = [...pts.current.values()]; return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }; };

  const down = (e: React.PointerEvent) => {
    if (!gestures || (e.target as HTMLElement).closest("button,a")) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* gone */ }
    const s = g.current;
    if (pts.current.size === 2) { s.mode = "pinch"; s.d0 = dist(); s.c0 = center(); s.z0 = { ...z.current }; }
    else { s.mode = "none"; s.sx = e.clientX; s.sy = e.clientY; s.st = performance.now(); s.dx = 0; s.dy = 0; s.z0 = { ...z.current }; }
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return; pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const s = g.current;
    if (s.mode === "pinch" && pts.current.size === 2) {
      const sc = clamp(s.z0.s * (dist() / s.d0), 0.8, 6); const c = center(); const r = root.current!.getBoundingClientRect(); const px = s.c0.x - r.left - r.width / 2; const py = s.c0.y - r.top - r.height / 2; const k = sc / s.z0.s;
      z.current = { s: sc, x: px - (px - s.z0.x) * k + (c.x - s.c0.x), y: py - (py - s.z0.y) * k + (c.y - s.c0.y) }; paint(); return;
    }
    if (pts.current.size !== 1) return;
    s.dx = e.clientX - s.sx; s.dy = e.clientY - s.sy;
    if (s.mode === "none" && Math.hypot(s.dx, s.dy) > 8) s.mode = z.current.s > 1.02 ? "pan" : Math.abs(s.dx) > Math.abs(s.dy) ? "page" : s.dy > 0 ? "dismiss" : "ignore";
    if (s.mode === "pan") { z.current.x = s.z0.x + s.dx; z.current.y = s.z0.y + s.dy; limit(); paint(); }
    else if (s.mode === "page" && track.current) {
      const edge = (s.dx > 0 && index === 0) || (s.dx < 0 && index === items.length - 1); track.current.style.transform = `translate3d(${edge ? s.dx * 0.3 : s.dx}px, 0, 0)`;
    } else if (s.mode === "dismiss" && track.current) {
      const p = clamp(s.dy / (h() * 0.6), 0, 1); track.current.style.transform = `translate3d(${s.dx * 0.4}px, ${s.dy}px, 0) scale(${1 - p * 0.25})`; if (bg.current) bg.current.style.opacity = String(1 - p); setChrome(false);
    }
  };
  const up = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return; pts.current.delete(e.pointerId); const s = g.current; const dt = Math.max(1, performance.now() - s.st);
    if (s.mode === "pinch") {
      if (pts.current.size < 2) {
        if (z.current.s < 1.05) zoomTo(1, 0, 0); else { limit(); paint(); }
        const [rest] = [...pts.current.values()]; s.mode = rest ? "pan" : "none"; if (rest) { s.sx = rest.x; s.sy = rest.y; s.z0 = { ...z.current }; }
      }
      return;
    }
    if (s.mode === "page") {
      const fast = Math.abs(s.dx) / dt > 0.45; const far = Math.abs(s.dx) > w() * 0.22; const dir = s.dx < 0 ? 1 : -1; const to = index + dir;
      if ((fast || far) && to >= 0 && to < items.length) glide(track.current, `translate3d(${dir * -100}%, 0, 0)`, () => { if (track.current) track.current.style.transform = ""; go(to); });
      else glide(track.current, "translate3d(0, 0, 0)", () => { if (track.current) track.current.style.transform = ""; });
    } else if (s.mode === "dismiss") {
      if (s.dy > 130 || s.dy / dt > 0.6) { glide(track.current, `translate3d(0, ${h()}px, 0) scale(0.75)`); if (bg.current) { bg.current.style.transition = "opacity 260ms ease-out"; bg.current.style.opacity = "0"; } setTimeout(() => closeRef.current(), 240); }
      else { glide(track.current, "translate3d(0, 0, 0)", () => { if (track.current) track.current.style.transform = ""; }); if (bg.current) { bg.current.style.transition = "opacity 240ms ease-out"; bg.current.style.opacity = "1"; } setChrome(true); }
    } else if (s.mode === "none" && e.type === "pointerup") {
      // a tap: once toggles the bars, twice zooms into the spot
      const now = performance.now();
      if (now - s.lastTap < 300 && Math.hypot(e.clientX - s.tapX, e.clientY - s.tapY) < 40) { clearTimeout(s.tapTimer); s.lastTap = 0; zoomTo(z.current.s > 1.05 ? 1 : 2.6, e.clientX, e.clientY); }
      else { s.lastTap = now; s.tapX = e.clientX; s.tapY = e.clientY; s.tapTimer = setTimeout(() => setChrome((c) => !c), 300); }
    }
    s.mode = "none";
  };
  const wheel = (e: React.WheelEvent) => { if (!gestures || !(e.ctrlKey || e.metaKey)) return; zoomTo(clamp(z.current.s * Math.exp(-e.deltaY * 0.01), 1, 6), e.clientX, e.clientY, false); };

  const slide = (i: number) => {
    const it = items[i]; if (!it) return null; const cur = i === index; const k = previewKind(it);
    return (
      <div key={it.id} className="absolute inset-0" style={{ transform: `translate3d(${(i - index) * 100}%, 0, 0)` }} aria-hidden={!cur}>
        {k === "image" ? (
          <img ref={cur ? img : undefined} src={cur && hi ? urls.preview(it) : it.hasThumbnail ? urls.thumb(it, 2048) : urls.preview(it)} alt={cur ? it.name : ""} draggable={false} decoding="async"
            className="absolute inset-0 size-full object-contain will-change-transform select-none" style={{ transformOrigin: "50% 50%" }} />
        ) : cur ? (
          k === "video" ? <div className="absolute inset-0 bg-black">{viewer(it)}</div>
            : <div className="absolute inset-0 overflow-hidden bg-surface pt-14 text-ink">{viewer(it)}</div>
        ) : null}
      </div>
    );
  };
  const bar = "pointer-events-none absolute inset-x-0 z-10 flex items-center gap-1 px-2 transition-[opacity,transform] duration-200 ease-out";
  const showTop = chrome || !gestures; const doc = kind !== "image" && kind !== "video";
  const Nav = ({ dir, label, children }: { dir: -1 | 1; label: string; children: ReactNode }) => items[index + dir] ? <button type="button" aria-label={label} onClick={() => go(index + dir)} className="pointer-events-auto grid size-11 place-items-center rounded-full active:bg-white/15">{children}</button> : null;
  const act = "pointer-events-auto flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium active:bg-white/15";

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={`Pratinjau ${f.name}`} className="anim-fade fixed inset-0 z-50 overflow-hidden text-white select-none" style={{ touchAction: gestures ? "none" : undefined }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onContextMenu={(e) => e.preventDefault()}>
      <div ref={bg} className="absolute inset-0 bg-black" />
      <div ref={track} className="absolute inset-0 will-change-transform">{slide(index - 1)}{slide(index)}{slide(index + 1)}</div>

      <div className={bar + " top-0 pt-2 pb-8 " + (doc ? "bg-black/85 pb-2" : "bg-gradient-to-b from-black/70 to-transparent")} style={{ opacity: showTop ? 1 : 0, transform: showTop ? "none" : "translateY(-12px)" }}>
        <button type="button" aria-label="Kembali" onClick={() => closeRef.current()} className="pointer-events-auto grid size-11 place-items-center rounded-full active:bg-white/15"><ArrowLeft className="size-6" /></button>
        <div className="min-w-0 flex-1 px-1"><p className="truncate text-[15px] font-semibold">{f.name}</p><p className="tnum truncate text-[12px] text-white/70">{index + 1} dari {items.length}{f.size !== null ? ` · ${formatBytes(f.size)}` : ""}</p></div>
        {!gestures && <><Nav dir={-1} label="Sebelumnya"><ChevronLeft className="size-6" /></Nav><Nav dir={1} label="Berikutnya"><ChevronRight className="size-6" /></Nav></>}
      </div>

      {gestures && (
        <div className={bar + " bottom-0 justify-around pt-8 pb-3 bg-gradient-to-t from-black/70 to-transparent"} style={{ opacity: chrome ? 1 : 0, transform: chrome ? "none" : "translateY(12px)" }}>
          {onShare && <button type="button" className={act} onClick={() => onShare(f)}><Share2 className="size-6" aria-hidden />Bagikan</button>}
          {canDownload && <button type="button" className={act} onClick={() => startDownload(urls.download(f), f.name)}><Download className="size-6" aria-hidden />Unduh</button>}
          <button type="button" className={act} aria-pressed={info} onClick={() => setInfo((v) => !v)}><Info className="size-6" aria-hidden />Detail</button>
        </div>)}

      <Presence show={info} exitMs={230}>{(closing) => (
        <div className="absolute inset-0 z-20" onPointerDown={(e) => e.stopPropagation()}>
          <div data-closing={closing || undefined} className="anim-fade absolute inset-0 bg-black/40" onClick={() => setInfo(false)} />
          <DetailsPanel closing={closing} entry={f} storageName={storageName} location={location ?? f.path} stats={false} extras={extras} onClose={() => setInfo(false)} className="anim-sheet absolute inset-x-0 bottom-0 max-h-[72%] rounded-t-2xl border-t border-line text-ink shadow-float" />
        </div>)}</Presence>
    </div>
  );
}
