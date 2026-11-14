import type { FileEntry } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { ChevronLeft, ChevronRight, Download, Info, Presentation, Printer, Share2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { startDownload } from "@/lib/download";
import { DetailsPanel } from "@/features/files/DetailsPanel";
import { printable, printFile } from "./print";
import { Slideshow } from "./Slideshow";
import { previewKind } from "@/lib/fileType";
import { IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/misc";
import { useFileUrls } from "@/features/files/urls";
import { AudioViewer, CsvViewer, DocxViewer, ImageViewer, JsonViewer, TextViewer, VideoViewer, XlsxViewer, ZipViewer } from "./viewers";

const PdfViewer = lazy(() => import("./PdfViewer"));
export const preloadPdf = () => Promise.all([import("./PdfViewer"), import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).catch(() => {});

function Viewer({ f }: { f: FileEntry }) {
  switch (previewKind(f)) {
    case "image": return <ImageViewer f={f} />;
    case "video": return <VideoViewer f={f} />;
    case "audio": return <AudioViewer f={f} />;
    case "pdf": return <Suspense fallback={<div className="grid h-full place-items-center"><Spinner className="size-6" /></div>}><PdfViewer f={f} /></Suspense>;
    case "json": return <JsonViewer f={f} />;
    case "csv": return <CsvViewer f={f} />;
    case "xlsx": return <XlsxViewer f={f} />;
    case "docx": return <DocxViewer f={f} />;
    case "zip": return <ZipViewer f={f} />;
    default: return <TextViewer f={f} />;
  }
}

/**
 * Preview in a centered window (not full screen), so the page behind stays recognisable and the layout never
 * shifts. Arrow keys move between previewable files, Escape closes.
 */
export function Preview({ items, index, onIndex, onClose, onShare, canDownload = true, location, storageName }: { location?: string; storageName?: string; items: FileEntry[]; index: number; onIndex(i: number): void; onClose(): void; onShare?(f: FileEntry): void; canDownload?: boolean }) {
  const f = items[index]; const urls = useFileUrls(); const panel = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState(false); const [show, setShow] = useState(false);
  const images = items.filter((x) => previewKind(x) === "image");
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input,textarea,select");
      if (show) return;
      if (e.key === "Escape") onClose();
      if (!typing && e.key.toLowerCase() === "i") setInfo((v) => !v);
      if (typing) return;
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [index, items.length, onClose, onIndex, show]);
  useEffect(() => { panel.current?.focus(); }, []);
  // Warm what is likely next: neighbouring images (browser cache) and the PDF engine, so flipping and opening feel instant.
  useEffect(() => {
    for (const d of [1, -1, 2]) { const n = items[index + d]; if (n && previewKind(n) === "image" && n.hasThumbnail) new Image().src = urls.thumb(n, 1024); }
    if (items.some((x) => previewKind(x) === "pdf")) void preloadPdf();
  }, [index, items, urls]);
  if (!f) return null;
  const Nav = ({ dir, children }: { dir: -1 | 1; children: ReactNode }) => {
    const target = index + dir; if (target < 0 || target >= items.length) return null;
    return <button aria-label={dir < 0 ? "Sebelumnya" : "Berikutnya"} onClick={() => onIndex(target)} className={`absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-surface/90 text-ink shadow-float hover:bg-surface ${dir < 0 ? "left-3" : "right-3"}`}>{children}</button>;
  };
  return (
    <div className="anim-fade fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Pratinjau ${f.name}`} className="anim-pop relative flex h-[min(88vh,860px)] w-[min(1120px,100%)] flex-col overflow-hidden rounded-2xl bg-surface text-ink shadow-float focus:outline-none">
        <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2 sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-2.5">
          <IconButton label="Tutup" className="order-[-1] ml-auto sm:order-last sm:ml-0" onClick={onClose}><X className="size-5" /></IconButton>
          <div className="order-[-2] min-w-0 basis-[calc(100%-52px)] sm:order-none sm:basis-0 sm:flex-1"><p className="truncate text-[14px] font-semibold" title={f.name}>{f.name}</p><p className="tnum text-[12px] text-muted">{formatBytes(f.size)} · {index + 1} dari {items.length}</p></div>
          <IconButton label="Detail" aria-pressed={info} className={info ? "bg-surface-2" : ""} onClick={() => setInfo(!info)}><Info className="size-[18px]" /></IconButton>
          {images.length > 0 && <IconButton label="Tayangan slide" onClick={() => setShow(true)}><Presentation className="size-[18px]" /></IconButton>}
          {canDownload && printable(f) && <IconButton label="Cetak" onClick={() => void printFile(f, urls.preview(f)).catch((e) => toast.error((e as Error).message))}><Printer className="size-[18px]" /></IconButton>}
          {onShare && <IconButton label="Bagikan" onClick={() => onShare(f)}><Share2 className="size-[18px]" /></IconButton>}
          {canDownload && <a href={urls.download(f)} aria-label="Unduh" onClick={(e) => { e.preventDefault(); startDownload(urls.download(f), f.name); }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-2.5 text-[13px] font-medium hover:bg-line sm:px-3"><Download className="size-4" aria-hidden /><span className="hidden sm:inline">Unduh</span></a>}
          </header>
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1"><Viewer key={f.id} f={f} /><Nav dir={-1}><ChevronLeft className="size-5" /></Nav><Nav dir={1}><ChevronRight className="size-5" /></Nav></div>
          {info && <DetailsPanel entry={f} storageName={storageName} location={location ?? f.path} stats={false} onClose={() => setInfo(false)} className="absolute inset-x-0 bottom-0 z-20 max-h-[65%] rounded-t-2xl border-t border-line shadow-float sm:static sm:max-h-none sm:w-72 sm:shrink-0 sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-none" />}
        </div>
        {show && <Slideshow items={images} start={Math.max(0, images.findIndex((x) => x.id === f.id))} onClose={() => setShow(false)} />}
      </div>
    </div>
  );
}
