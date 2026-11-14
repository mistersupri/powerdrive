import type { FileEntry } from "@superdrive/shared";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/misc";
import { useFileUrls } from "@/features/files/urls";

type Doc = import("pdfjs-dist").PDFDocumentProxy;

/** Continuous-scroll PDF viewer. Pages render only when they approach the viewport, and the file streams via Range requests. */
export default function PdfViewer({ f }: { f: FileEntry }) {
  const urls = useFileUrls(); const url = urls.preview(f);
  const [doc, setDoc] = useState<Doc | null>(null); const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState<number | "fit">("fit"); const [page, setPage] = useState(1);
  const box = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(800); const [draft, setDraft] = useState<string | null>(null); const pageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false; let task: { destroy(): Promise<void> } | null = null; setDoc(null); setErr(null);
    (async () => {
      const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const t = pdfjs.getDocument({ url, withCredentials: true, rangeChunkSize: 512 * 1024 }); task = t;
      const d = await t.promise; if (!dead) setDoc(d);
    })().catch((e) => !dead && setErr(e?.name === "PasswordException" ? "PDF ini dilindungi kata sandi." : "Tidak dapat membuka PDF ini."));
    return () => { dead = true; void task?.destroy(); };
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
        <span className="flex-1" />
        <form className="flex items-center gap-1.5 text-muted" onSubmit={(e) => { e.preventDefault(); goTo(Number(draft ?? page), doc.numPages); pageInput.current?.blur(); }}>
          <label htmlFor="pdf-page" className="sr-only">Pergi ke halaman</label>Halaman
          <input id="pdf-page" ref={pageInput} inputMode="numeric" pattern="[0-9]*" value={draft ?? String(page)} onFocus={(e) => { setDraft(String(page)); e.currentTarget.select(); }} onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => setDraft(null)}
            className="tnum h-8 w-14 rounded-md border border-line-strong bg-surface px-1 text-center text-[16px] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-[13px]" />
          <span className="tnum">/ {doc.numPages}</span>
        </form>
      </div>
      <div ref={box} className="scroll-thin min-h-0 flex-1 overflow-auto bg-[#d9dee6] p-3 dark:bg-[#0d1626]">
        <div className="mx-auto flex w-fit flex-col gap-3">{Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} fitWidth={Math.max(280, width - 28)} zoom={z} onVisible={setPage} />)}</div>
      </div>
    </div>
  );
}

function PdfPage({ doc, n, fitWidth, zoom, onVisible }: { doc: Doc; n: number; fitWidth: number; zoom?: number; onVisible(n: number): void }) {
  const ref = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
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
  return <div ref={ref} data-page={n} className="bg-white shadow-card" style={{ width: dim.w, height: dim.h }}>{near && <canvas ref={canvas} style={{ width: dim.w, height: dim.h }} />}</div>;
}
