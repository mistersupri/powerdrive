import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Music,
  File as FileGenericIcon,
  Loader2
} from "lucide-react";
import { api } from "../services/api.ts";
import { FileItem, PreviewStatus } from "../types/frontend.ts";
import { VideoThumbnail } from "./VideoThumbnail.tsx";

interface LazyThumbnailProps {
  file: FileItem;
}

const getFileCategory = (mimeType: string, originalName: string): string => {
  if (!mimeType) {
    const ext = originalName.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      pdf: "pdf",
      png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image", ico: "image", avif: "image",
      mp4: "video", webm: "video", ogg: "video", mkv: "video", mov: "video", avi: "video", wmv: "video",
      mp3: "audio", wav: "audio", flac: "audio", m4a: "audio", ogg_audio: "audio",
      zip: "archive", rar: "archive", tar: "archive", gz: "archive", "7z": "archive",
      js: "code", ts: "code", jsx: "code", tsx: "code", html: "code", css: "code", json: "code", py: "code", go: "code", rs: "code", sh: "code",
      doc: "document", docx: "document", txt: "document", rtf: "document", odt: "document",
      xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet", ods: "spreadsheet"
    };
    return mimeMap[ext] || "other";
  }

  const mime = mimeType.toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return "spreadsheet";
  if (mime.includes("word") || mime.includes("document") || mime.includes("text/plain")) return "document";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("archive") || mime.includes("tar")) return "archive";
  if (mime.includes("javascript") || mime.includes("typescript") || mime.includes("json") || mime.includes("html") || mime.includes("css") || mime.startsWith("text/")) return "code";
  
  return "other";
};

export const LazyThumbnail: React.FC<LazyThumbnailProps> = ({ file }) => {
  const [isInView, setIsInView] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>(file.previewStatus || PreviewStatus.PENDING);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const category = getFileCategory(file.mimeType || "", file.originalName);
  const ext = file.originalName.split(".").pop()?.toUpperCase() || "FILE";

  // IntersectionObserver Setup with preload margin buffer (300px)
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.unobserve(element); // Trigger once, then stop observing
          }
        });
      },
      {
        rootMargin: "300px", // preloads 300px before appearing in viewport
      }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, [file.id]);

  // Polling PreviewStatus Setup when file is in view and not READY/FAILED
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    if (isInView && (previewStatus === PreviewStatus.PENDING || previewStatus === PreviewStatus.PROCESSING)) {
      intervalId = setInterval(async () => {
        try {
          const res = await api.getFile(file.id);
          if (res && res.file) {
            const currentStatus = res.file.previewStatus;
            setPreviewStatus(currentStatus);
            if (currentStatus === PreviewStatus.READY || currentStatus === PreviewStatus.FAILED) {
              if (intervalId) clearInterval(intervalId);
            }
          }
        } catch (err) {
          console.warn("[LazyThumbnail] Error polling file preview status:", err);
        }
      }, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isInView, previewStatus, file.id]);

  // Reset state on file change
  useEffect(() => {
    setPreviewStatus(file.previewStatus || PreviewStatus.PENDING);
  }, [file.id, file.previewStatus]);

  if (!isInView) {
    // Return high-quality, lightweight preview card shell
    return (
      <div
        ref={containerRef}
        className="w-full h-36 sm:h-40 bg-slate-50/50 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-slate-100 select-none animate-pulse"
      >
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300">
          <ImageIcon className="w-7 h-7" />
        </div>
        <span className="text-[9px] font-extrabold tracking-wider text-slate-400 bg-slate-100/80 px-2 py-0.5 rounded-full">
          PRE-LOADING...
        </span>
      </div>
    );
  }

  // If the worker is still rendering, return an animated spinner representation
  if (previewStatus === PreviewStatus.PENDING || previewStatus === PreviewStatus.PROCESSING) {
    return (
      <div
        ref={containerRef}
        className="w-full h-36 sm:h-40 bg-slate-900 rounded-t-xl flex flex-col items-center justify-center gap-2 border-b border-slate-800 select-none relative"
      >
        <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
        </div>
        <span className="text-[10px] font-extrabold tracking-wider text-indigo-300 bg-indigo-950/50 border border-indigo-800/30 px-2 py-0.5 rounded-full animate-pulse">
          MEMPROSES PRATINJAU...
        </span>
      </div>
    );
  }

  // A. Image format category
  if (category === "image") {
    return (
      <div
        ref={containerRef}
        className="w-full h-36 sm:h-40 bg-slate-100 rounded-t-xl overflow-hidden flex items-center justify-center relative border-b border-slate-100 select-none group"
      >
        {/* Beautiful blur placeholder skeleton shown while loading */}
        {!isImageLoaded && (
          <div className="absolute inset-0 bg-slate-200/60 backdrop-blur-md flex items-center justify-center animate-pulse z-10">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}
        <img
          src={api.getThumbnailUrl(file.id)}
          alt={file.originalName}
          className={`w-full h-full object-cover group-hover:scale-105 pointer-events-none transition-all duration-700 ease-out ${
            isImageLoaded ? "blur-0 scale-100 opacity-100" : "blur-xl scale-110 opacity-50"
          }`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setIsImageLoaded(true)}
          onError={(e) => {
            setIsImageLoaded(true);
            e.currentTarget.style.display = "none";
            const fallback = e.currentTarget.parentElement?.querySelector(".image-fallback");
            if (fallback) fallback.classList.remove("hidden");
          }}
        />
        <div className="image-fallback hidden flex flex-col items-center justify-center gap-2 p-4 text-purple-600">
          <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center shadow-xs">
            <ImageIcon className="w-8 h-8 text-purple-600" />
          </div>
          <span className="text-[10px] font-extrabold tracking-wider bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
            {ext}
          </span>
        </div>
      </div>
    );
  }

  // B. Document PDF format category
  if (category === "pdf") {
    return (
      <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-rose-50 to-rose-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-rose-100 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-rose-200 flex items-center justify-center text-rose-600 group-hover:scale-105 transition-transform">
          <FileText className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 bg-white/90 border border-rose-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          DOKUMEN PDF
        </span>
      </div>
    );
  }

  // C. Spreadsheet sheets format category
  if (category === "spreadsheet") {
    return (
      <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-emerald-50 to-emerald-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-emerald-100 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-emerald-200 flex items-center justify-center text-emerald-600 group-hover:scale-105 transition-transform">
          <FileSpreadsheet className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-white/90 border border-emerald-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          LEMBAR SEBAR ({ext})
        </span>
      </div>
    );
  }

  // D. Standard document format category
  if (category === "document") {
    return (
      <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-blue-50 to-blue-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-blue-100 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-blue-200 flex items-center justify-center text-blue-600 group-hover:scale-105 transition-transform">
          <FileText className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 bg-white/90 border border-blue-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          DOKUMEN WORD ({ext})
        </span>
      </div>
    );
  }

  // E. Video playback formats category
  if (category === "video") {
    return (
      <div ref={containerRef} className="w-full">
        <VideoThumbnail
          file={file}
          className="w-full h-36 sm:h-40 border-b border-purple-100/50"
        />
      </div>
    );
  }

  // F. Audio music formats category
  if (category === "audio") {
    return (
      <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-teal-50 to-teal-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-teal-100 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-teal-200 flex items-center justify-center text-teal-600 group-hover:scale-105 transition-transform">
          <Music className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700 bg-white/90 border border-teal-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          AUDIO ({ext})
        </span>
      </div>
    );
  }

  // G. Archive zip formats category
  if (category === "archive") {
    return (
      <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-amber-50 to-amber-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-amber-100 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-amber-200 flex items-center justify-center text-amber-600 group-hover:scale-105 transition-transform">
          <FileArchive className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 bg-white/90 border border-amber-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          ARSIP ZIP ({ext})
        </span>
      </div>
    );
  }

  // H. Source code scripts category
  if (category === "code") {
    return (
      <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-indigo-50 to-indigo-100/60 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-indigo-100 select-none">
        <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-indigo-200 flex items-center justify-center text-indigo-600 group-hover:scale-105 transition-transform">
          <FileCode className="w-9 h-9" />
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 bg-white/90 border border-indigo-200 px-2.5 py-0.5 rounded-full shadow-2xs">
          SKRIP / KODE ({ext})
        </span>
      </div>
    );
  }

  // I. Default generic category
  return (
    <div ref={containerRef} className="w-full h-36 sm:h-40 bg-linear-to-b from-slate-50 to-slate-100 rounded-t-xl flex flex-col items-center justify-center gap-2.5 border-b border-slate-200 select-none">
      <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-slate-200 flex items-center justify-center text-slate-500 group-hover:scale-105 transition-transform">
        <FileGenericIcon className="w-9 h-9" />
      </div>
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 bg-white/90 border border-slate-200 px-2.5 py-0.5 rounded-full shadow-2xs">
        BERKAS {ext}
      </span>
    </div>
  );
};
