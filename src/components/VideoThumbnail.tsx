import React, { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { fileExtension } from "../lib/fileType.ts";
import { cn } from "../lib/cn.ts";

interface VideoThumbnailProps {
  name: string;
  /** Pre-rendered poster image (e.g. a Google Drive thumbnail), tried first. */
  posterUrl?: string;
  /** Playable URL; its first frame is used when there is no poster. */
  videoUrl: string;
  className?: string;
}

function formatDuration(seconds: number) {
  if (!seconds || Number.isNaN(seconds)) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Video card preview: poster or first frame, a play mark and the duration. */
export const VideoThumbnail: React.FC<VideoThumbnailProps> = ({ name, posterUrl, videoUrl, className }) => {
  const [posterFailed, setPosterFailed] = useState(!posterUrl);
  const [frameFailed, setFrameFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [duration, setDuration] = useState<string | null>(null);

  useEffect(() => {
    setPosterFailed(!posterUrl);
    setFrameFailed(false);
    setLoaded(false);
    setDuration(null);
  }, [posterUrl, videoUrl]);

  const ext = fileExtension(name).toUpperCase() || "VIDEO";

  return (
    <div className={cn("relative overflow-hidden bg-night-900 select-none flex items-center justify-center", className)}>
      {!posterFailed && (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setPosterFailed(true)}
          className={cn("w-full h-full object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
      {posterFailed && !frameFailed && (
        <video
          src={`${videoUrl}${videoUrl.includes("?") ? "&" : "?"}quality=low#t=0.5`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          onLoadedMetadata={(e) => setDuration(formatDuration(e.currentTarget.duration))}
          onLoadedData={() => setLoaded(true)}
          onError={() => setFrameFailed(true)}
          className={cn(
            "w-full h-full object-cover pointer-events-none transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="w-10 h-10 rounded-full bg-night-950/55 ring-1 ring-white/25 flex items-center justify-center text-white">
          <Play className="w-4 h-4 ml-0.5 fill-white" />
        </span>
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1">
        <span className="h-5 px-1.5 rounded-md bg-night-950/70 text-night-100 text-[11px] font-semibold flex items-center">{ext}</span>
        {duration && (
          <span className="h-5 px-1.5 rounded-md bg-night-950/70 text-night-100 text-[11px] font-semibold flex items-center tabular">
            {duration}
          </span>
        )}
      </div>
    </div>
  );
};
