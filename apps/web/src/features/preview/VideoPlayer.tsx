import type { FileEntry } from "@superdrive/shared";
import { Check, ChevronDown, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useFileUrls } from "@/features/files/urls";

/** Seek step: 5 s, but never more than a tenth of a short clip. */
export const seekStep = (d: number) => (!isFinite(d) || d <= 0 ? 5 : Math.min(5, Math.max(1, Math.round((d / 10) * 2) / 2)));
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ACCENT = "#f5b301"; // the single accent: played part of the track and the thumb

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const store = { get: (k: string, d: number) => { try { const v = Number(localStorage.getItem(k)); return isFinite(v) && localStorage.getItem(k) !== null ? v : d; } catch { return d; } }, set: (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } } };

/**
 * Own video player: thin custom track with buffered ranges, tap / double-tap / hold gestures, skip, speed, volume,
 * picture-in-picture and fullscreen. The track is a real slider (keyboard + screen reader) and a 44px touch target.
 */
export function VideoPlayer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const box = useRef<HTMLDivElement>(null); const vid = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLDivElement>(null); const thumb = useRef<HTMLDivElement>(null); const timeEl = useRef<HTMLSpanElement>(null); const track = useRef<HTMLDivElement>(null);
  const scrub = useRef<{ on: boolean; frac: number; last: number }>({ on: false, frac: 0, last: 0 });
  const [playing, setPlaying] = useState(false); const [duration, setDuration] = useState(0); const [waiting, setWaiting] = useState(true); const [ended, setEnded] = useState(false);
  const [buffered, setBuffered] = useState<[number, number][]>([]); const [vol, setVol] = useState(() => store.get("sd-vol", 1)); const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(() => store.get("sd-rate", 1)); const [menu, setMenu] = useState(false); const [show, setShow] = useState(true); const [full, setFull] = useState(false);
  const [tip, setTip] = useState<{ x: number; t: number } | null>(null); const [fast, setFast] = useState(false);
  const [flash, setFlash] = useState<{ side: "l" | "r"; text: string; n: number } | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined); const pipOk = typeof document !== "undefined" && !!document.pictureInPictureEnabled;
  const step = seekStep(duration);

  const wake = useCallback(() => { setShow(true); clearTimeout(hide.current); hide.current = setTimeout(() => setShow(false), 2800); }, []);
  useEffect(() => { wake(); return () => clearTimeout(hide.current); }, [wake]);
  const keepOpen = menu || scrub.current.on || !playing; // controls stay while paused, scrubbing or with the speed menu open
  useEffect(() => { if (keepOpen) { clearTimeout(hide.current); setShow(true); } else wake(); }, [keepOpen, wake]);

  // Smooth playhead without re-rendering React on every frame.
  const paint = useCallback((t: number) => {
    const v = vid.current; const d = v?.duration || 0; const p = d ? Math.min(1, Math.max(0, t / d)) * 100 : 0;
    if (fill.current) fill.current.style.width = p + "%"; if (thumb.current) thumb.current.style.left = p + "%"; if (timeEl.current) timeEl.current.textContent = fmt(t);
  }, []);
  useEffect(() => {
    let raf = 0; const loop = () => { const v = vid.current; if (v && !scrub.current.on) paint(v.currentTime); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [paint]);

  useEffect(() => { const v = vid.current; if (v) { v.volume = vol; v.muted = muted; } }, [vol, muted]);
  useEffect(() => { const v = vid.current; if (v && !fast) v.playbackRate = rate; }, [rate, fast, f.id]);
  useEffect(() => { const c = () => setFull(!!document.fullscreenElement && document.fullscreenElement === box.current); document.addEventListener("fullscreenchange", c); return () => document.removeEventListener("fullscreenchange", c); }, []);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 650); return () => clearTimeout(t); }, [flash]);

  const toggle = useCallback(() => { const v = vid.current; if (!v) return; if (v.paused || v.ended) void v.play(); else v.pause(); }, []);
  const seekTo = (t: number) => { const v = vid.current; if (!v) return; const d = isFinite(v.duration) ? v.duration : t; v.currentTime = Math.max(0, Math.min(d, t)); paint(v.currentTime); setEnded(false); };
  const skip = useCallback((dir: -1 | 1, side: "l" | "r") => { const v = vid.current; if (!v) return; seekTo(v.currentTime + dir * seekStep(v.duration)); setFlash((x) => ({ side, text: `${dir < 0 ? "−" : "+"}${seekStep(v.duration)} dtk`, n: (x?.n ?? 0) + 1 })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fullscreen = () => {
    const el = box.current; const v = vid.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen(); else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {}); else v?.webkitEnterFullscreen?.();
  };
  const pip = () => { const v = vid.current; if (!v) return; if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void v.requestPictureInPicture().catch(() => {}); };
  const setVolume = (x: number) => { const n = Math.min(1, Math.max(0, x)); setVol(n); setMuted(n === 0); store.set("sd-vol", n); };
  const pickRate = (r: number) => { setRate(r); store.set("sd-rate", r); setMenu(false); };

  // Keyboard: Space / K play, M mute, F fullscreen, J / L skip. Buttons and the slider keep their own keys.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t?.closest("input,textarea,select,button,[role=slider],[role=menuitem]")) return;
      const key = e.key.toLowerCase();
      if (key === " " || key === "k") { e.preventDefault(); toggle(); wake(); } else if (key === "m") setMuted((m) => !m); else if (key === "f") fullscreen(); else if (key === "j") skip(-1, "l"); else if (key === "l") skip(1, "r");
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [toggle, skip, wake]);

  // Track: pointer drag with capture; the video follows (throttled), the playhead follows instantly.
  const frac = (e: React.PointerEvent | PointerEvent) => { const r = track.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const trackDown = (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); const s = scrub.current; s.on = true; s.frac = frac(e); const d = vid.current?.duration || 0; paint(s.frac * d); setTip({ x: s.frac, t: s.frac * d }); setShow(true); };
  const trackMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = scrub.current; const d = vid.current?.duration || 0; const f2 = frac(e); if (!s.on) { setTip({ x: f2, t: f2 * d }); return; }
    s.frac = f2; paint(f2 * d); setTip({ x: f2, t: f2 * d }); if (Date.now() - s.last > 120) { s.last = Date.now(); if (vid.current) vid.current.currentTime = f2 * d; }
  };
  const trackUp = (e: React.PointerEvent<HTMLDivElement>) => { const s = scrub.current; if (!s.on) return; s.on = false; const d = vid.current?.duration || 0; seekTo(frac(e) * d); setTip(null); wake(); };
  const trackKey = (e: React.KeyboardEvent) => {
    const v = vid.current; if (!v) return; const d = v.duration || 0; const big = Math.max(step * 2, d / 10);
    const map: Record<string, number> = { ArrowLeft: v.currentTime - step, ArrowRight: v.currentTime + step, ArrowDown: v.currentTime - step, ArrowUp: v.currentTime + step, PageDown: v.currentTime - big, PageUp: v.currentTime + big, Home: 0, End: d };
    if (e.key in map) { e.preventDefault(); e.stopPropagation(); seekTo(map[e.key]!); }
  };

  // Gestures on the picture: tap = play/pause, double tap = skip, hold = 2x.
  const g = useRef<{ tap?: ReturnType<typeof setTimeout>; lastTap: number; lastSide: string; hold?: ReturnType<typeof setTimeout>; holding: boolean; moved: boolean; x: number; y: number; prev: number }>({ lastTap: 0, lastSide: "", holding: false, moved: false, x: 0, y: 0, prev: 1 });
  useEffect(() => () => { clearTimeout(g.current.tap); clearTimeout(g.current.hold); }, []);
  const endHold = () => { const s = g.current; clearTimeout(s.hold); if (s.holding) { s.holding = false; setFast(false); if (vid.current) vid.current.playbackRate = s.prev; } };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current; s.moved = false; s.x = e.clientX; s.y = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); wake();
    s.hold = setTimeout(() => { const v = vid.current; if (!v || s.moved) return; s.holding = true; s.prev = v.playbackRate; v.playbackRate = 2; if (v.paused) void v.play(); setFast(true); clearTimeout(s.tap); }, 380);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => { const s = g.current; wake(); if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 12) { s.moved = true; clearTimeout(s.hold); } };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current; const was = s.holding; endHold(); if (was || s.moved) return;
    const r = e.currentTarget.getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width; const side = rel < 0.38 ? "l" : rel > 0.62 ? "r" : "c"; const now = Date.now();
    if (now - s.lastTap < 320 && s.lastSide === side && side !== "c") { clearTimeout(s.tap); s.lastTap = 0; skip(side === "l" ? -1 : 1, side); return; }
    s.lastTap = now; s.lastSide = side; clearTimeout(s.tap); s.tap = setTimeout(toggle, 330);
  };

  const VolIcon = muted || vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;
  const pct = duration ? (v: number) => (v / duration) * 100 : () => 0;
  const btn = "relative grid size-11 shrink-0 place-items-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:bg-white/20 focus-visible:outline-2 focus-visible:outline-white active:scale-95";
  const skipBtn = (dir: -1 | 1) => (
    <button type="button" className={btn} aria-label={`${dir < 0 ? "Mundur" : "Maju"} ${step} detik`} onClick={() => skip(dir, dir < 0 ? "l" : "r")}>
      {dir < 0 ? <RotateCcw className="size-6" strokeWidth={1.75} /> : <RotateCw className="size-6" strokeWidth={1.75} />}
      <span className="tnum absolute text-[9px] leading-none font-bold">{step % 1 ? step.toFixed(1) : step}</span>
    </button>
  );
  const uiShown = show || keepOpen;

  return (
    <div ref={box} className={cn("relative size-full overflow-hidden bg-black select-none", !uiShown && playing && "cursor-none")} onMouseMove={wake}>
      <video ref={vid} key={f.id} src={urls.preview(f)} autoPlay preload="metadata" playsInline className="absolute inset-0 size-full bg-black object-contain"
        onPlay={() => { setPlaying(true); setEnded(false); }} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setEnded(true); }}
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); const v = e.currentTarget; v.volume = vol; v.muted = muted; v.playbackRate = rate; }} onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)} onSeeked={() => setWaiting(false)} onError={() => setWaiting(false)}
        onProgress={(e) => { const b = e.currentTarget.buffered; const out: [number, number][] = []; for (let i = 0; i < b.length; i++) out.push([b.start(i), b.end(i)]); setBuffered(out); }} />

      {/* gesture layer: everything above the control bar */}
      <div className="absolute inset-x-0 top-0 bottom-28 touch-manipulation" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={endHold} onContextMenu={(e) => e.preventDefault()} aria-hidden />

      {waiting && !ended && <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="size-10 animate-spin text-white/80" aria-label="Memuat video" /></div>}
      {!playing && !waiting && (
        <button type="button" aria-label={ended ? "Putar ulang" : "Putar"} onClick={() => { if (ended) seekTo(0); toggle(); }} className="absolute top-[42%] left-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-float transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <Play className="ml-1 size-9 fill-current" />
        </button>
      )}
      {flash && <div key={flash.n} className={cn("pointer-events-none absolute top-[42%] grid size-24 -translate-y-1/2 place-items-center rounded-full bg-white/25 text-[14px] font-semibold text-white backdrop-blur-sm", flash.side === "l" ? "left-[10%]" : "right-[10%]")}>{flash.text}</div>}
      {fast && <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[13px] font-semibold text-white">2× ▶▶</div>}

      {/* control bar */}
      <div className={cn("absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-10 pb-2 text-white transition-opacity duration-200 sm:px-4", uiShown ? "opacity-100" : "pointer-events-none opacity-0")} onPointerDown={wake}>
        <div className="mb-0.5 flex items-center justify-between text-[14px] font-medium tabular-nums"><span ref={timeEl}>0:00</span><span className="text-white/80">{fmt(duration)}</span></div>
        <div role="slider" tabIndex={0} aria-label="Posisi video" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(vid.current?.currentTime ?? 0)} aria-valuetext={`${fmt(vid.current?.currentTime ?? 0)} dari ${fmt(duration)}`}
          className="group relative flex h-9 cursor-pointer touch-none items-center focus-visible:outline-none" onPointerDown={trackDown} onPointerMove={trackMove} onPointerUp={trackUp} onPointerCancel={trackUp} onPointerLeave={() => { if (!scrub.current.on) setTip(null); }} onKeyDown={trackKey}>
          <div ref={track} className="relative h-1 w-full rounded-full bg-white/30 transition-[height] group-hover:h-1.5 group-focus-visible:h-1.5 group-focus-visible:ring-2 group-focus-visible:ring-white">
            {buffered.map(([a, b], i) => <div key={i} className="absolute inset-y-0 rounded-full bg-white/45" style={{ left: pct(a) + "%", width: pct(b - a) + "%" }} />)}
            <div ref={fill} className="absolute inset-y-0 left-0 rounded-full" style={{ background: ACCENT, width: "0%" }} />
            <div ref={thumb} className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-transform group-hover:scale-125 group-active:scale-150" style={{ background: ACCENT, left: "0%" }} />
          </div>
          {tip && <div className="pointer-events-none absolute -top-5 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[12px] tabular-nums" style={{ left: `clamp(24px, ${tip.x * 100}%, calc(100% - 24px))` }}>{fmt(tip.t)}</div>}
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" className={btn} aria-label={playing ? "Jeda" : "Putar"} onClick={() => { toggle(); wake(); }}>{playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}</button>
          {skipBtn(-1)}{skipBtn(1)}
          <div className="group/vol flex items-center">
            <button type="button" className={btn} aria-label={muted ? "Suarakan" : "Bisukan"} onClick={() => setMuted((m) => !m)}><VolIcon className="size-6" strokeWidth={1.75} /></button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} aria-label="Volume" onChange={(e) => setVolume(Number(e.target.value))} className="hidden h-1 w-0 cursor-pointer appearance-none overflow-hidden rounded-full bg-white/40 opacity-0 accent-white transition-[width,opacity] group-hover/vol:w-20 group-hover/vol:opacity-100 group-focus-within/vol:w-20 group-focus-within/vol:opacity-100 md:block" />
          </div>
          <span className="flex-1" />
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} className="flex h-11 items-center gap-1 rounded-full px-3 text-[15px] font-medium tabular-nums hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white" onClick={() => setMenu((m) => !m)}>{rate}x<ChevronDown className="size-4" /></button>
            {menu && (
              <div role="menu" aria-label="Kecepatan putar" className="anim-pop absolute right-0 bottom-12 z-20 min-w-28 rounded-xl border border-white/10 bg-black/90 p-1 shadow-float backdrop-blur" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); } }}>
                {RATES.map((r) => <button key={r} type="button" role="menuitemradio" aria-checked={rate === r} autoFocus={rate === r} onClick={() => pickRate(r)} className="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px] tabular-nums hover:bg-white/15 focus-visible:bg-white/20 focus-visible:outline-none"><span className="grid size-4 place-items-center">{rate === r && <Check className="size-4" />}</span>{r === 1 ? "Normal" : `${r}x`}</button>)}
              </div>
            )}
          </div>
          {pipOk && <button type="button" className={cn(btn, "max-sm:hidden")} aria-label="Gambar dalam gambar" onClick={pip}><PictureInPicture2 className="size-6" strokeWidth={1.75} /></button>}
          <button type="button" className={btn} aria-label={full ? "Keluar layar penuh" : "Layar penuh"} onClick={fullscreen}>{full ? <Minimize className="size-6" strokeWidth={1.75} /> : <Maximize className="size-6" strokeWidth={1.75} />}</button>
        </div>
      </div>
    </div>
  );
}
