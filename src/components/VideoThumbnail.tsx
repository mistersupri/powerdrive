import React, { useState, useRef, useEffect } from "react";
import { Video, Play, AlertCircle, Film } from "lucide-react";
import { api } from "../services/api.ts";

interface VideoThumbnailProps {
  file: {
    id: string;
    originalName: string;
    size?: number;
    mimeType?: string;
    googleDriveFileId?: string | null;
    googleDriveThumbnailLink?: string | null;
    [key: string]: any;
  };
  className?: string;
  showPlayBadge?: boolean;
}

export const VideoThumbnail: React.FC<VideoThumbnailProps> = ({
  file,
  className = "w-full h-36 sm:h-40",
  showPlayBadge = true,
}) => {
  const ext = file.originalName.split(".").pop()?.toUpperCase() || "MP4";
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);
  const [videoFrameLoaded, setVideoFrameLoaded] = useState<boolean>(false);
  const [videoFrameError, setVideoFrameError] = useState<boolean>(false);
  const [duration, setDuration] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const isGDrive = Boolean(
    file.googleDriveFileId &&
      !file.googleDriveFileId.startsWith("gdrive_") &&
      !file.googleDriveFileId.startsWith("virtual_")
  );

  const thumbnailUrl = api.getThumbnailUrl(file.id);

  const viewUrl = api.getViewUrl(file.id);

  // Format seconds to mm:ss
  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return null;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setVideoFrameLoaded(false);
    setVideoFrameError(false);
    setDuration(null);
  }, [file.id, file.googleDriveFileId]);

  return (
    <div
      className={`relative overflow-hidden bg-slate-900 rounded-t-xl select-none flex items-center justify-center group ${className}`}
    >
      {/* 0. BASE PLACEHOLDER / SKELETON (always present until image or frame is loaded) */}
      {!imageLoaded && !videoFrameLoaded && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950/40 flex flex-col items-center justify-center gap-2 p-3 text-center">
          <div className="w-11 h-11 rounded-2xl bg-purple-500/15 border border-purple-500/20 flex items-center justify-center text-purple-300 shadow-inner group-hover:scale-105 transition-transform">
            <Video className="w-5 h-5 text-purple-400" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 bg-purple-900/40 border border-purple-700/40 px-2 py-0.5 rounded-full">
            {ext}
          </span>
        </div>
      )}

      {/* 1. PRIMARY: Try Image/GDrive Thumbnail */}
      {!imageError && isGDrive && (
        <img
          src={thumbnailUrl}
          alt={file.originalName}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 pointer-events-none ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* 2. SECONDARY: If GDrive Image Thumbnail fails or local video, use HTML5 Video First-Frame Snapshot */}
      {(!isGDrive || imageError) && !videoFrameError && (
        <video
          ref={videoRef}
          src={`${viewUrl}${viewUrl.includes("?") ? "&" : "?"}quality=low`}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const target = e.currentTarget;
            if (target.duration && !isNaN(target.duration)) {
              setDuration(formatDuration(target.duration));
            }
            // Seek slightly forward to avoid black first frame if needed
            try {
              if (target.currentTime === 0 && target.duration > 0.5) {
                target.currentTime = 0.5;
              }
            } catch (err) {
              // ignore
            }
          }}
          onLoadedData={() => setVideoFrameLoaded(true)}
          onCanPlay={() => setVideoFrameLoaded(true)}
          onSeeked={() => setVideoFrameLoaded(true)}
          onError={() => setVideoFrameError(true)}
          className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 pointer-events-none ${
            videoFrameLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Subtle Vignette Gradient Overlay when thumbnail is visible */}
      {(imageLoaded || videoFrameLoaded) && (
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-black/20 pointer-events-none" />
      )}

      {/* Play Button Overlay */}
      {showPlayBadge && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-slate-950/60 group-hover:bg-purple-600 border border-white/20 backdrop-blur-xs flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-all">
            <Play className="w-4 h-4 ml-0.5 fill-white" />
          </div>
        </div>
      )}

      {/* Extension Badge & Duration Pill */}
      <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
        <span className="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold font-mono bg-purple-900/80 border border-purple-400/30 text-purple-200 uppercase shadow-xs backdrop-blur-xs">
          {ext}
        </span>
        {duration && (
          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-semibold bg-black/70 text-slate-200 shadow-xs backdrop-blur-xs">
            {duration}
          </span>
        )}
      </div>
    </div>
  );
};
