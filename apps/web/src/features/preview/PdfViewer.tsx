import type { FileEntry } from "@superdrive/shared";
import { Copy, Maximize2, Minus, Plus, ScanText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { wheelZoomFactor } from "@/lib/wheelZoom";
import { recognize, type OcrResult } from "@/lib/ocr";
import { usePersistentState } from "@/lib/usePersistentState";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/misc";
import { useFileUrls } from "@/features/files/urls";

type Doc = import("pdfjs-dist").PDFDocumentProxy;

/** Continuous-scroll PDF viewer. Pages render only when they approach the viewport, and the file streams via Range requests. */
export default function PdfViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const url = urls.preview(f);
  const [doc, setDoc] = useState<Doc | null>(null); const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState<number | "fit">("fit"); const [page, setPage] = useState(1);
  const [ocrOn, setOcrOn] = usePersistentState<boolean>("sd-pdf-ocr", true); const texts = useRef(new Map<number, string>()); const onText = useCallback((n: number, t: string) => { texts.current.set(n, t); }, []);
  const box = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(800); const [draft, setDraft] = useState<string | null>(null); const pageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false; const tasks: { destroy(): Promise<void> }[] = []; setDoc(null); setErr(null);
    (async () => {
      const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const open = async (src: Parameters<typeof pdfjs.getDocument>[0]) => { const t = pdfjs.getDocument(src); tasks.push(t); return t.promise; };
      let d: Doc;
      try {
        // Normal path: stream the file and fetch only the byte ranges that are needed.
        d = await open({ url, withCredentials: true, rangeChunkSize: 512 * 1024 });
      } catch (first) {
        if ((first as { name?: string })?.name === "PasswordException") throw first;
        // Some storage providers answer range requests badly. Download the whole file once instead, and say what really went wrong.
        const res = await fetch(url, { credentials: "include" }).catch(() => null);
        if (!res) throw new Error("Tidak dapat menghubungi server.");
        if (!res.ok) { const j = await res.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(`${j?.error?.message ?? "Server menolak permintaan"} (HTTP ${res.status})`); }
        const buf = new Uint8Array(await res.arrayBuffer());
        try { d = await open({ data: buf }); }
        catch (second) {
          if ((second as { name?: string })?.name === "PasswordException") throw second;
          const head = new TextDecoder().decode(buf.slice(0, 5));
          throw new Error(head === "%PDF-" ? `Berkas PDF ini rusak atau memakai fitur yang belum didukung (${(second as Error)?.name ?? "galat"}).` : `Berkas ini bukan PDF yang valid (jenis ${res.headers.get("content-type") ?? "tidak diketahui"}, ${buf.length} byte).`);
        }
      }
      if (!dead) setDoc(d);
    })().catch((e) => !dead && setErr(e?.name === "PasswordException" ? "PDF ini dilindungi kata sandi." : `Tidak dapat membuka PDF ini. ${e instanceof Error ? e.message : ""}`.trim()));
    return () => { dead = true; tasks.forEach((t) => void t.destroy()); };
  }, [url]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width))); ro.observe(el); return () => ro.disconnect();
  }, []);
  // Jump to a page: type a number and press Enter (G focuses the box; Home/End go to the first/last page).
  const goTo = (n: number, total: number) => { const t = Math.min(total, Math.max(1, Math.round(n) || 1)); box.current?.querySelector<HTMLElement>(`[data-page="${t}"]`)?.scrollIntoView({ block: "start" }); setPage(t); setDraft(null); };
  useEffect(() => {
    if (!doc) return; const total = doc.numPages;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key.toLowerCase() === "g") { e.preventDefault(); pageInput.current?.focus(); pageInput.current?.select(); }
      else if (e.key === "Home") { e.preventDefault(); goTo(1, total); } else if (e.key === "End") { e.preventDefault(); goTo(total, total); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // Ctrl+scroll (also what a trackpad pinch sends) and two-finger pinch change the zoom; they must be native, non-passive listeners to stop the browser zooming the page.
  const [pageW, setPageW] = useState(612); // width of page 1 at scale 1, so "fit" has a real number to zoom from
  useEffect(() => { if (doc) void doc.getPage(1).then((pg) => setPageW(pg.getViewport({ scale: 1 }).width)).catch(() => {}); }, [doc]);
  const scaleRef = useRef<number>(1); scaleRef.current = typeof scale === "number" ? scale : Math.max(0.4, Math.min(4, Math.max(280, width - 28) / pageW));
  useEffect(() => {
    const el = box.current; if (!el || !doc) return;
    const clamp = (v: number) => Math.min(4, Math.max(0.4, v));
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setScale(clamp(scaleRef.current * wheelZoomFactor(e))); };
    let start: { d: number; s: number } | null = null; let raf = 0; let next = 0;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const ts = (e: TouchEvent) => { start = e.touches.length === 2 ? { d: dist(e.touches), s: scaleRef.current } : null; };
    const tm = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !start) return; e.preventDefault(); next = clamp(start.s * (dist(e.touches) / start.d));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setScale(next); });
    };
    const te = () => { start = null; };
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("touchstart", ts, { passive: true }); el.addEventListener("touchmove", tm, { passive: false }); el.addEventListener("touchend", te);
    return () => { el.removeEventListener("wheel", wheel); el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); if (raf) cancelAnimationFrame(raf); };
  }, [doc]);
  // The text of the page being looked at: recognised text if the page was scanned, otherwise what the PDF itself carries.
  const copyPage = async () => {
    if (!doc) return;
    try {
      let t = texts.current.get(page);
      if (!t) { const pg = await doc.getPage(page); t = (await pg.getTextContent()).items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("").trim(); }
      if (!t) { toast.info(ocrOn ? "Belum ada teks di halaman ini. OCR masih berjalan atau tidak menemukan teks." : "Halaman ini tidak punya teks. Nyalakan OCR untuk mengenalinya."); return; }
      await navigator.clipboard.writeText(t); toast.success(`Teks halaman ${page} disalin`);
    } catch { toast.error("Tidak dapat menyalin teks."); }
  };
  if (err) return <div className="grid h-full place-items-center p-8 text-center text-[14px] text-muted">{err}</div>;
  if (!doc) return <div className="grid h-full place-items-center"><Spinner className="size-6" /></div>;
  const z = scale === "fit" ? undefined : scale;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3 py-2 text-[13px]">
        <IconButton label="Perkecil" onClick={() => setScale(Math.max(0.4, (typeof scale === "number" ? scale : 1) / 1.2))}><Minus className="size-4" /></IconButton>
        <span className="tnum w-12 text-center text-muted">{scale === "fit" ? "Pas" : `${Math.round(scale * 100)}%`}</span>
        <IconButton label="Perbesar" onClick={() => setScale(Math.min(4, (typeof scale === "number" ? scale : 1) * 1.2))}><Plus className="size-4" /></IconButton>
        <IconButton label="Pas lebar" onClick={() => setScale("fit")}><Maximize2 className="size-4" /></IconButton>
        <button type="button" aria-pressed={ocrOn} title="Kenali teks pada halaman hasil pindai secara otomatis" onClick={() => setOcrOn(!ocrOn)} className={cn("ml-1 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 pointer-coarse:h-11", ocrOn ? "bg-primary-soft text-primary-ink" : "text-muted hover:bg-surface-2")}><ScanText className="size-4" aria-hidden /><span className="max-sm:sr-only">OCR otomatis</span></button>
        <IconButton label="Salin teks halaman" onClick={() => void copyPage()}><Copy className="size-4" /></IconButton>
        <span className="flex-1" />
        <form className="flex items-center gap-1.5 text-muted" onSubmit={(e) => { e.preventDefault(); goTo(Number(draft ?? page), doc.numPages); pageInput.current?.blur(); }}>
          <label htmlFor="pdf-page" className="sr-only">Pergi ke halaman</label>Halaman
          <input id="pdf-page" ref={pageInput} inputMode="numeric" pattern="[0-9]*" value={draft ?? String(page)} onFocus={(e) => { setDraft(String(page)); e.currentTarget.select(); }} onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => setDraft(null)}
            className="tnum h-8 w-14 rounded-md border border-line-strong bg-surface px-1 text-center text-[16px] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-[13px]" />
          <span className="tnum">/ {doc.numPages}</span>
        </form>
      </div>
      <div ref={box} style={{ touchAction: "pan-x pan-y" }} className="scroll-thin min-h-0 flex-1 overflow-auto bg-[#d9dee6] p-3 dark:bg-[#0d1626]">
        <div className="mx-auto flex w-fit flex-col gap-3">{Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} fitWidth={Math.max(280, width - 28)} zoom={z} onVisible={setPage} ocrOn={ocrOn} onText={onText} />)}</div>
      </div>
    </div>
  );
}

function PdfPage({ doc, n, fitWidth, zoom, onVisible, ocrOn, onText }: { doc: Doc; n: number; fitWidth: number; zoom?: number; onVisible(n: number): void; ocrOn: boolean; onText(n: number, t: string): void }) {
  const ref = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null); const [ocrBusy, setOcrBusy] = useState(false); const tried = useRef(false);
  const [near, setNear] = useState(false); const [dim, setDim] = useState<{ w: number; h: number }>({ w: fitWidth, h: fitWidth * 1.3 });
  useEffect(() => {
    const el = ref.current!; const io = new IntersectionObserver(([e]) => { setNear(e!.isIntersecting); if (e!.isIntersecting && e!.intersectionRatio > 0.3) onVisible(n); }, { rootMargin: "600px 0px", threshold: [0, 0.3] });
    io.observe(el); return () => io.disconnect();
  }, [n, onVisible]);
  useEffect(() => {
    let cancelled = false; let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    doc.getPage(n).then((pg) => {
      const base = pg.getViewport({ scale: 1 }); const s = zoom ?? fitWidth / base.width; const vp = pg.getViewport({ scale: s });
      if (cancelled) return; setDim({ w: Math.floor(vp.width), h: Math.floor(vp.height) });
      if (!near || !canvas.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); const c = canvas.current;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      task = pg.render({ canvas: c, viewport: pg.getViewport({ scale: s * dpr }) } as any); task.promise.catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, n, near, fitWidth, zoom]);
  // Scanned pages carry no text. With OCR on, recognise them once (when they come into view) and lay the words over the picture, invisible but selectable.
  useEffect(() => {
    if (!ocrOn || !near || tried.current) return; let cancelled = false;
    (async () => {
      const pg = await doc.getPage(n);
      if ((await pg.getTextContent()).items.some((i) => "str" in i && i.str.trim())) { tried.current = true; return; }
      tried.current = true; if (cancelled) { tried.current = false; return; }
      setOcrBusy(true);
      const base = pg.getViewport({ scale: 1 }); const off = document.createElement("canvas"); const vp = pg.getViewport({ scale: Math.min(3, 1600 / base.width) });
      off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
      await pg.render({ canvas: off, viewport: vp } as any).promise;
      const r = await recognize(off, () => false);
      if (r) { setOcr(r); onText(n, r.text); }
    })().catch(() => { tried.current = false; }).finally(() => setOcrBusy(false));
    return () => { cancelled = true; };
  }, [ocrOn, near, doc, n, onText]);
  return (
    <div ref={ref} data-page={n} className="relative bg-white shadow-card" style={{ width: dim.w, height: dim.h }}>
      {near && <canvas ref={canvas} style={{ width: dim.w, height: dim.h }} />}
      {ocr && <div className="absolute inset-0 overflow-hidden" aria-label={`Teks hasil OCR halaman ${n}`}>
        {ocr.words.map((w, i) => <span key={i} className="absolute cursor-text leading-none whitespace-pre text-transparent selection:bg-primary/30 selection:text-transparent" style={{ left: `${(w.x0 / ocr.width) * 100}%`, top: `${(w.y0 / ocr.height) * 100}%`, width: `${((w.x1 - w.x0) / ocr.width) * 100}%`, height: `${((w.y1 - w.y0) / ocr.height) * 100}%`, fontSize: dim.h * ((w.y1 - w.y0) / ocr.height) * 0.85 }}>{w.text} </span>)}
      </div>}
      {ocrBusy && <span role="status" className="absolute top-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white">Mengenali teks…</span>}
    </div>
  );
}
