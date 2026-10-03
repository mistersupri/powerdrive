import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../services/api.ts";
import { FileItem, PreviewStatus } from "../types/frontend.ts";
import { VideoThumbnail } from "./VideoThumbnail.tsx";
import { categoryLabel, fileExtension, getFileCategory } from "../lib/fileType.ts";
import { FileTypeIcon } from "../ui/FileTypeIcon.tsx";
import { cn } from "../lib/cn.ts";

interface LazyThumbnailProps {
  file: FileItem;
  /** Override the image source (mounted drives serve files from their own endpoint). */
  imageUrl?: string;
  /** Override the playable video source. */
  videoUrl?: string;
  className?: string;
}

const POLL_MS = 4000;
const MAX_POLLS = 30;

/**
 * Card preview that only loads once it scrolls near the viewport. While the
 * server is still rendering a preview it polls the file (bounded) and then
 * swaps in the image; everything else shows a quiet type tile.
 */
export const LazyThumbnail: React.FC<LazyThumbnailProps> = ({ file, imageUrl, videoUrl, className }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [status, setStatus] = useState<PreviewStatus>(file.previewStatus || PreviewStatus.PENDING);
  const [imgState, setImgState] = useState<"loading" | "loaded" | "failed">("loading");

  const category = getFileCategory(file.mimeType, file.originalName);
  const frame = cn("w-full h-32 sm:h-36", className);

  useEffect(() => {
    setStatus(file.previewStatus || PreviewStatus.PENDING);
    setImgState("loading");
  }, [file.id, file.previewStatus]);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const isRendering = status === PreviewStatus.PENDING || status === PreviewStatus.PROCESSING;

  useEffect(() => {
    if (!inView || !isRendering || imageUrl) return;
    let polls = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      try {
        const res = await api.getFile(file.id);
        const next = res?.file?.previewStatus;
        if (!cancelled && next && next !== status) setStatus(next);
      } catch {
        // Keep the placeholder; the next poll may succeed.
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inView, isRendering, imageUrl, file.id, status]);

  if (!inView) {
    return <div ref={ref} className={cn(frame, "bg-ink-50")} aria-hidden />;
  }

  if (category === "video") {
    const isDriveVideo = !!file.googleDriveFileId && !/^(gdrive_|virtual_)/.test(file.googleDriveFileId);
    return (
      <div ref={ref}>
        <VideoThumbnail
          name={file.originalName}
          posterUrl={isDriveVideo ? api.getThumbnailUrl(file.id) : undefined}
          videoUrl={videoUrl || api.getViewUrl(file.id)}
          className={frame}
        />
      </div>
    );
  }

  if (category === "image" && !imageUrl && isRendering) {
    return (
      <div ref={ref} className={cn(frame, "bg-ink-50 flex flex-col items-center justify-center gap-2 text-ink-500")}>
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Menyiapkan pratinjau</span>
      </div>
    );
  }

  if (category === "image" && imgState !== "failed") {
    return (
      <div ref={ref} className={cn(frame, "relative bg-ink-100 overflow-hidden")}>
        <img
          src={imageUrl || api.getThumbnailUrl(file.id)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setImgState("loaded")}
          onError={() => setImgState("failed")}
          className={cn(
            "w-full h-full object-cover pointer-events-none transition-opacity duration-200",
            imgState === "loaded" ? "opacity-100" : "opacity-0"
          )}
        />
      </div>
    );
  }

  const ext = fileExtension(file.originalName).toUpperCase();
  return (
    <div ref={ref} className={cn(frame, "bg-ink-50 flex flex-col items-center justify-center gap-2 border-b border-ink-100")}>
      <FileTypeIcon category={category} className="w-9 h-9 text-ink-600" />
      <span className="text-[11px] font-semibold text-ink-500">{ext || categoryLabel[category]}</span>
    </div>
  );
};
