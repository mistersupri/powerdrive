import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Search,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Music,
  Video,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  RefreshCw,
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
} from "lucide-react";
import { FileItem, SyncStatus } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useTransfer } from "../context/TransferContext.tsx";

interface FilePreviewModalProps {
  file: FileItem | null;
  filesList?: FileItem[];
  onClose: () => void;
  onNavigateFile?: (file: FileItem) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  filesList = [],
  onClose,
  onNavigateFile,
}) => {
  const { startFileDownload } = useTransfer();
  // Image Viewer Transform States
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Image Viewer States
  const [imageLoading, setImageLoading] = useState<boolean>(true);
  const [imageError, setImageError] = useState<boolean>(false);

  // Video Viewer States
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoading, setVideoLoading] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [selectedQuality, setSelectedQuality] = useState<"low" | "medium" | "original">("medium");

  // Text / Code Viewer States
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState<boolean>(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [textWrap, setTextWrap] = useState<boolean>(true);
  const [textSearch, setTextSearch] = useState<string>("");
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);

  // Reset controls when current file changes
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setImageLoading(true);
    setImageError(false);
    setVideoLoading(true);
    setVideoError(false);
    setIsPlaying(false);
    setIsMuted(true);
    setPlaybackRate(1);
    setCurrentTime(0);
    setDuration(0);
    setSelectedQuality("medium");
    setTextContent(null);
    setTextError(null);
    setTextSearch("");
    setCopiedText(false);
    setCopiedHash(false);

    if (!file) return;

    const mimeType = file.mimeType || "";
    // Detect if text/code file
    const isTextFile =
      mimeType.startsWith("text/") ||
      mimeType.includes("json") ||
      mimeType.includes("javascript") ||
      mimeType.includes("typescript") ||
      mimeType.includes("xml") ||
      /\.(txt|md|csv|tsv|json|js|ts|tsx|jsx|html|css|scss|xml|yaml|yml|sql|log|env|py|sh|bat|ini|conf|prisma|toml|graphql|rs|go|java|cpp|c|h|swift|kt|vue|svelte|properties|lock)$/i.test(
        file.originalName
      );

    if (isTextFile) {
      setTextLoading(true);
      if (file.mountSource) {
        api
          .getMountFileContent(file.mountSource.mountId, file.mountSource.relativePath)
          .then((res) => {
            setTextContent(res.content);
          })
          .catch((err) => {
            setTextError(err.message || "Gagal memuat konten teks berkas");
          })
          .finally(() => {
            setTextLoading(false);
          });
      } else {
        api
          .getFileTextContent(file.id)
          .then((res) => {
            setTextContent(res.content);
          })
          .catch((err) => {
            setTextError(err.message || "Gagal memuat konten teks berkas");
          })
          .finally(() => {
            setTextLoading(false);
          });
      }
    }
  }, [file]);

  // Find index in filesList
  const currentIndex = file && filesList.length > 0 ? filesList.findIndex((f) => f.id === file.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < filesList.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigateFile) {
      onNavigateFile(filesList[currentIndex - 1]);
    }
  }, [hasPrev, onNavigateFile, filesList, currentIndex]);

  const handleNext = useCallback(() => {
    if (hasNext && onNavigateFile) {
      onNavigateFile(filesList[currentIndex + 1]);
    }
  }, [hasNext, onNavigateFile, filesList, currentIndex]);

  // Keyboard navigation & shortcuts. The listener is registered once and reads the
  // latest callbacks from a ref: re-registering on every render could drop a key
  // press when another window listener triggers a re-render mid-dispatch.
  const keyActions = useRef({ onClose, handlePrev, handleNext });
  keyActions.current = { onClose, handlePrev, handleNext };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const a = keyActions.current;
      if (e.key === "Escape") {
        a.onClose();
      } else if (e.key === "ArrowLeft") {
        a.handlePrev();
      } else if (e.key === "ArrowRight") {
        a.handleNext();
      } else if (e.key === "+" || e.key === "=") {
        setZoom((prev) => Math.min(prev + 0.25, 4));
      } else if (e.key === "-") {
        setZoom((prev) => Math.max(prev - 0.25, 0.5));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!file) return null;

  const viewUrl = file.mountSource?.viewUrl || api.getViewUrl(file.id);
  const downloadUrl = file.mountSource?.downloadUrl || api.getDownloadUrl(file.id);

  const mimeType = file.mimeType || "";

  const isImage =
    mimeType.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif)$/i.test(file.originalName);

  const isVideo =
    mimeType.startsWith("video/") ||
    /\.(mp4|webm|ogg|mov|m4v|mkv|avi)$/i.test(file.originalName);

  const viewUrlWithQuality = (() => {
    let url = viewUrl;
    if (selectedQuality && (isImage || isVideo)) {
      url += (url.includes("?") ? "&" : "?") + `quality=${selectedQuality}`;
    }
    return url;
  })();

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.currentTime = val;
    setCurrentTime(val);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  const isAudio =
    mimeType.startsWith("audio/") ||
    /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(file.originalName);

  const isPdf =
    mimeType === "application/pdf" ||
    /\.pdf$/i.test(file.originalName);

  const isText =
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("xml") ||
    /\.(txt|md|csv|tsv|json|js|ts|tsx|jsx|html|css|scss|xml|yaml|yml|sql|log|env|py|sh|bat|ini|conf|prisma|toml|graphql|rs|go|java|cpp|c|h|swift|kt|vue|svelte|properties|lock)$/i.test(
      file.originalName
    );

  const isOfficeDoc =
    /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(file.originalName) ||
    mimeType.includes("word") ||
    mimeType.includes("sheet") ||
    mimeType.includes("presentation");

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleCopyText = () => {
    if (!textContent) return;
    navigator.clipboard.writeText(textContent);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleCopyHash = () => {
    if (!file.checksumSha256) return;
    navigator.clipboard.writeText(file.checksumSha256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Filtered text lines for search
  const textLines = (textContent || "").split("\n");

  return (
    <div
      id="file-preview-modal-backdrop"
      className="fixed inset-0 z-50 bg-night-950/80 flex items-center justify-center p-2 sm:p-4 md:p-6 transition duration-300 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        id="file-preview-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Pratinjau ${file.originalName}`}
        className="bg-night-900 border border-night-700/80 rounded-2xl w-full max-w-5xl h-[92vh] max-h-[850px] flex flex-col shadow-float overflow-hidden relative text-night-100"
      >
        {/* TOP BAR / HEADER */}
        <div className="h-16 px-4 sm:px-6 bg-night-900/95 border-b border-night-800 flex items-center justify-between gap-3 shrink-0 select-none">
          {/* File Meta */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-night-800 border border-night-700 flex items-center justify-center text-night-400 shrink-0 ">
              {isImage && <ImageIcon className="w-5 h-5 text-night-400" />}
              {isVideo && <Video className="w-5 h-5 text-night-400" />}
              {isAudio && <Music className="w-5 h-5 text-ok-400" />}
              {isPdf && <FileText className="w-5 h-5 text-danger-400" />}
              {isText && <FileCode className="w-5 h-5 text-warn-400" />}
              {isOfficeDoc && <FileSpreadsheet className="w-5 h-5 text-night-400" />}
              {!isImage && !isVideo && !isAudio && !isPdf && !isText && !isOfficeDoc && (
                <FileArchive className="w-5 h-5 text-night-400" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3
                  className="text-sm font-bold text-night-100 truncate max-w-xs sm:max-w-md md:max-w-lg"
                  title={file.originalName}
                >
                  {file.originalName}
                </h3>

                {/* Sync Badge */}
                {(() => {
                  const isFolderSynced = !!(file.folder?.syncToGoogleDrive && file.folder?.googleDriveFolderId);
                  if (!isFolderSynced || file.syncStatus === SyncStatus.LOCAL_ONLY) {
                    return null;
                  }
                  return file.syncStatus === SyncStatus.SYNCED ? (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-ok-500/10 text-ok-400 border border-ok-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      Drive
                    </span>
                  ) : (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-warn-500/10 text-warn-400 border border-warn-500/20">
                      <AlertCircle className="w-3 h-3" />
                      Lokal
                    </span>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2 text-[11px] text-night-400">
                <span>{formatBytes(file.size)}</span>
                <span>•</span>
                <span className="truncate max-w-[140px] font-mono">{file.mimeType || "Dokumen"}</span>
                {filesList.length > 0 && currentIndex >= 0 && (
                  <>
                    <span>•</span>
                    <span className="text-night-500">
                      {currentIndex + 1} dari {filesList.length}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Open in new tab */}
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="p-2 text-night-400 hover:text-night-100 hover:bg-night-800 rounded-xl transition"
              title="Buka di Tab Baru"
            >
              <ExternalLink className="w-4 h-4" />
            </a>

            {/* Google Drive Link */}
            {file.googleDriveWebViewLink && (
              <a
                href={file.googleDriveWebViewLink}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-night-500/10 text-night-400 hover:bg-night-500/20 border border-night-500/30 transition"
                title="Buka di Akun Google Drive Resmi"
              >
                <span>Google Drive</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {/* Real-time Streaming Download Button */}
            <button
              onClick={() => startFileDownload(file.id, file.originalName, file.size)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-night-600 hover:bg-night-500 text-white shadow-card active:scale-95 transition cursor-pointer"
              title="Unduh Berkas ke Komputer (Real-time Progress)"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Unduh</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 text-night-400 hover:text-white hover:bg-night-800 rounded-xl transition cursor-pointer"
              title="Tutup Pratinjau (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PREVIEW CONTENT BODY */}
        <div className="flex-1 bg-night-950/60 relative overflow-hidden flex items-center justify-center p-2 sm:p-4">
          {/* PREVIOUS FILE BUTTON */}
          {hasPrev && (
            <button
              onClick={handlePrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-night-900/80 hover:bg-night-800 text-night-200 border border-night-700 flex items-center justify-center shadow-card transition hover:scale-110 active:scale-95 cursor-pointer"
              title="Berkas Sebelumnya (Panah Kiri)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          {/* NEXT FILE BUTTON */}
          {hasNext && (
            <button
              onClick={handleNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-night-900/80 hover:bg-night-800 text-night-200 border border-night-700 flex items-center justify-center shadow-card transition hover:scale-110 active:scale-95 cursor-pointer"
              title="Berkas Selanjutnya (Panah Kanan)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          {/* 1. IMAGE VIEWER */}
          {isImage && (
            <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
              {imageLoading && !imageError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-night-400 gap-2 z-10">
                  <Loader2 className="w-8 h-8 animate-spin text-night-500" />
                  <p className="text-xs">Memuat gambar...</p>
                </div>
              )}

              {imageError ? (
                <div className="flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md">
                  <div className="w-16 h-16 rounded-2xl bg-danger-500/10 border border-danger-500/20 text-danger-400 flex items-center justify-center ">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white mb-1">Pratinjau Gambar Tidak Tersedia</h4>
                    <p className="text-xs text-night-400 leading-relaxed">
                      Berkas gambar belum selesai diunduh dari server atau tersimpan di Google Drive. Anda dapat mengunduh langsung atau membuka di Google Drive.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2.5 justify-center pt-2">
                    <a
                      href={downloadUrl}
                      download={file.originalName}
                      className="px-4 py-2 bg-night-600 hover:bg-night-500 text-white rounded-xl text-xs font-bold shadow-card inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh Berkas</span>
                    </a>
                    {file.googleDriveWebViewLink && (
                      <a
                        href={file.googleDriveWebViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 bg-night-800 hover:bg-night-700 text-night-200 border border-night-700 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-night-400" />
                        <span>Buka di Google Drive</span>
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center overflow-auto p-4 select-none">
                  <img
                    src={viewUrlWithQuality}
                    alt={file.originalName}
                    onLoad={() => setImageLoading(false)}
                    onError={() => {
                      setImageLoading(false);
                      setImageError(true);
                    }}
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                    className={`max-w-full max-h-full object-contain rounded-lg shadow-float origin-center ${
                      imageLoading ? "opacity-0" : "opacity-100"
                    }`}
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              {/* Floating Image Control Dock */}
              {!imageError && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-night-900/90 border border-night-700/80 rounded-2xl px-3 py-1.5 flex items-center gap-1 shadow-float text-night-300">
                  <button
                    onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
                    className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                    title="Perkecil (-)"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono font-semibold px-1 min-w-[42px] text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={() => setZoom((z) => Math.min(z + 0.25, 4))}
                    className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                    title="Perbesar (+)"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <div className="h-4 w-px bg-night-700 mx-1" />
                  <button
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                    title="Putar 90° Searah Jarum Jam"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setZoom(1);
                      setRotation(0);
                    }}
                    className="text-[11px] font-semibold px-2 py-1 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                    title="Kembalikan Tampilan Normal"
                  >
                    Reset
                  </button>
                  <div className="h-4 w-px bg-night-700 mx-1" />
                  {/* Quality selector */}
                  <div className="flex items-center gap-1 bg-night-800/80 rounded-lg p-0.5 border border-night-700">
                    {(["low", "medium", "original"] as const).map((q) => (
                      <button
                        key={q}
                        onClick={() => setSelectedQuality(q)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase transition cursor-pointer ${
                          selectedQuality === q
                            ? "bg-night-600 text-white shadow-card"
                            : "text-night-400 hover:text-white"
                        }`}
                        title={`Kualitas: ${q === "low" ? "Rendah (Low)" : q === "medium" ? "Sedang (Medium)" : "Asli (Original)"}`}
                      >
                        {q === "low" ? "Low" : q === "medium" ? "Med" : "Orig"}
                      </button>
                    ))}
                  </div>
                  <div className="h-4 w-px bg-night-700 mx-1" />
                  <button
                    onClick={toggleFullscreen}
                    className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                    title={isFullscreen ? "Keluar Layar Penuh" : "Layar Penuh"}
                  >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2. VIDEO PLAYER */}
          {isVideo && (
            <div className="w-full h-full flex flex-col items-center justify-center p-2 sm:p-4 relative overflow-hidden select-none">
              {videoLoading && !videoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-night-400 gap-2 z-10 bg-night-950/40">
                  <Loader2 className="w-8 h-8 animate-spin text-night-400" />
                  <p className="text-xs">Memuat video...</p>
                </div>
              )}

              {videoError ? (
                <div className="flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md bg-night-900/90 border border-night-800 rounded-2xl shadow-float">
                  <div className="w-16 h-16 rounded-2xl bg-night-500/10 border border-night-500/20 text-night-400 flex items-center justify-center ">
                    <Video className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white mb-1">Pratinjau Video Tidak Didukung Langsung</h4>
                    <p className="text-xs text-night-400 leading-relaxed">
                      Format atau codec berkas video ini ({file.originalName.split(".").pop()?.toUpperCase() || "VIDEO"}) tidak dapat diputar langsung di peramban web tanpa konversi. Anda dapat mengunduh berkas atau memutarnya melalui Google Drive.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2.5 justify-center pt-2">
                    <button
                      onClick={() => startFileDownload(file.id, file.originalName, file.size)}
                      className="px-4 py-2 bg-night-600 hover:bg-night-500 text-white rounded-xl text-xs font-bold shadow-card inline-flex items-center gap-1.5 cursor-pointer active:scale-95 transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh Berkas Video</span>
                    </button>
                    {file.googleDriveWebViewLink && (
                      <a
                        href={file.googleDriveWebViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 bg-night-800 hover:bg-night-700 text-night-200 border border-night-700 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-night-400" />
                        <span>Buka di Google Drive</span>
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center relative">
                  <video
                    ref={videoRef}
                    key={viewUrlWithQuality}
                    playsInline
                    autoPlay
                    muted={isMuted}
                    preload="metadata"
                    onLoadedData={() => {
                      setVideoLoading(false);
                      setVideoError(false);
                      videoRef.current?.play().catch(() => {});
                    }}
                    onCanPlay={() => {
                      setVideoLoading(false);
                      setVideoError(false);
                    }}
                    onWaiting={() => setVideoLoading(true)}
                    onPlaying={() => {
                      setVideoLoading(false);
                      setIsPlaying(true);
                    }}
                    onPause={() => setIsPlaying(false)}
                    onError={() => {
                      setVideoLoading(false);
                      setVideoError(true);
                    }}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                    className="max-w-full max-h-full rounded-2xl shadow-float border border-night-800 bg-black outline-hidden"
                  >
                    <source src={viewUrlWithQuality} type={file.mimeType || "video/mp4"} />
                    <source src={viewUrlWithQuality} />
                    Browser Anda tidak mendukung pemutar video HTML5 langsung.
                  </video>
                </div>
              )}

              {/* Floating Video Control Dock */}
              {!videoError && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[90%] max-w-2xl bg-night-900/95 border border-night-700/80 rounded-2xl px-4 py-2 flex flex-col gap-2 shadow-float text-night-300">
                  {/* Timeline Slider & Time Display */}
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-[11px] font-mono text-night-400 select-none min-w-[35px] text-right">
                      {formatTime(currentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      value={currentTime}
                      onChange={handleSeek}
                      className="grow h-1.5 rounded-lg appearance-none cursor-pointer accent-night-500 bg-night-700/60 hover:bg-night-700 transition focus:outline-hidden"
                      style={{
                        background: `linear-gradient(to right, rgb(168, 85, 247) 0%, rgb(168, 85, 247) ${duration ? (currentTime / duration) * 100 : 0}%, rgba(51, 65, 85, 0.6) ${duration ? (currentTime / duration) * 100 : 0}%, rgba(51, 65, 85, 0.6) 100%)`
                      }}
                    />
                    <span className="text-[11px] font-mono text-night-400 select-none min-w-[35px]">
                      {formatTime(duration)}
                    </span>
                  </div>

                  {/* Actions / Control Buttons row */}
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (!videoRef.current) return;
                          if (videoRef.current.paused) {
                            videoRef.current.play().catch(() => {});
                          } else {
                            videoRef.current.pause();
                          }
                        }}
                        className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                        title={isPlaying ? "Jeda (Pause)" : "Putar (Play)"}
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>

                      <button
                        onClick={() => {
                          if (!videoRef.current) return;
                          videoRef.current.currentTime = 0;
                          videoRef.current.play().catch(() => {});
                        }}
                        className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                        title="Ulangi dari Awal"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Playback speed selector */}
                      <div className="flex items-center gap-0.5">
                        {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.playbackRate = rate;
                                setPlaybackRate(rate);
                              }
                            }}
                            className={`px-1.5 py-0.5 rounded-md text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                              playbackRate === rate
                                ? "bg-night-600 text-white"
                                : "text-night-400 hover:text-white hover:bg-night-800"
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>

                      <div className="h-4 w-px bg-night-700" />

                      {/* Quality selector */}
                      <div className="flex items-center gap-1 bg-night-800/80 rounded-lg p-0.5 border border-night-700">
                        {(["low", "medium", "original"] as const).map((q) => (
                          <button
                            key={q}
                            onClick={() => setSelectedQuality(q)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase transition cursor-pointer ${
                              selectedQuality === q
                                ? "bg-night-600 text-white shadow-card"
                                : "text-night-400 hover:text-night-200"
                            }`}
                            title={`Kualitas: ${q === "low" ? "Rendah (Low)" : q === "medium" ? "Sedang (Medium)" : "Asli (Original)"}`}
                          >
                            {q === "low" ? "Low" : q === "medium" ? "Med" : "Orig"}
                          </button>
                        ))}
                      </div>

                      <div className="h-4 w-px bg-night-700" />

                      {/* Mute button */}
                      <button
                        onClick={() => {
                          if (!videoRef.current) return;
                          const nextMute = !videoRef.current.muted;
                          videoRef.current.muted = nextMute;
                          setIsMuted(nextMute);
                        }}
                        className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                        title={isMuted ? "Bunyikan Audio" : "Bisukan Audio"}
                      >
                        {isMuted ? <VolumeX className="w-4 h-4 text-danger-400" /> : <Volume2 className="w-4 h-4" />}
                      </button>

                      <button
                        onClick={toggleFullscreen}
                        className="p-1.5 hover:text-white hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
                        title={isFullscreen ? "Keluar Layar Penuh" : "Layar Penuh"}
                      >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. AUDIO PLAYER */}
          {isAudio && (
            <div className="w-full max-w-lg bg-night-900 border border-night-800 rounded-2xl p-8 shadow-float text-center space-y-6 animate-pop-in">
              <div className="w-20 h-20 rounded-2xl bg-ok-500/10 border border-ok-500/20 text-ok-400 flex items-center justify-center mx-auto ">
                <Music className="w-10 h-10" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white mb-1 truncate">{file.originalName}</h4>
                <p className="text-xs text-night-400">Audio • {formatBytes(file.size)}</p>
              </div>
              <audio src={viewUrl} controls autoPlay className="w-full rounded-xl bg-night-800" />
            </div>
          )}

          {/* 4. PDF VIEWER */}
          {isPdf && (
            <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden border border-night-800 bg-night-900 shadow-float">
              <iframe
                src={`${viewUrl}#toolbar=1&navpanes=0`}
                title={file.originalName}
                className="w-full h-full border-0 rounded-2xl bg-white"
              />
            </div>
          )}

          {/* 5. TEXT / CODE VIEWER */}
          {isText && (
            <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden border border-night-800 bg-night-900/90 shadow-float">
              {/* Text Control Bar */}
              <div className="px-4 py-2 bg-night-800/80 border-b border-night-700/80 flex items-center justify-between gap-3 text-xs">
                {/* Search in text */}
                <div className="flex items-center gap-2 bg-night-900 px-2.5 py-1.5 rounded-xl border border-night-700 text-night-300 w-48 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-night-400" />
                  <input
                    type="text"
                    value={textSearch}
                    onChange={(e) => setTextSearch(e.target.value)}
                    placeholder="Cari dalam teks..."
                    className="bg-transparent border-0 outline-hidden text-xs text-white placeholder-night-500 w-full"
                  />
                  {textSearch && (
                    <button
                      onClick={() => setTextSearch("")}
                      className="text-night-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTextWrap((w) => !w)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                      textWrap
                        ? "bg-night-600 text-white"
                        : "bg-night-700 text-night-300 hover:bg-night-600"
                    }`}
                    title="Bungkus Baris Panjang (Word Wrap)"
                  >
                    Wrap: {textWrap ? "ON" : "OFF"}
                  </button>

                  <button
                    onClick={handleCopyText}
                    className="flex items-center gap-1.5 px-3 py-1 bg-night-700 hover:bg-night-600 text-night-200 rounded-lg transition-colors font-medium cursor-pointer"
                    title="Salin Semua Konten Teks"
                  >
                    {copiedText ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-ok-400" />
                        <span className="text-ok-400">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Salin Teks</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Text Content Area */}
              <div className="flex-1 overflow-auto p-4 font-mono text-xs text-night-200 bg-night-950">
                {textLoading ? (
                  <div className="h-full flex flex-col items-center justify-center text-night-400 space-y-3">
                    <Loader2 className="w-6 h-6 animate-spin text-night-500" />
                    <p>Memuat konten teks berkas...</p>
                  </div>
                ) : textError ? (
                  <div className="h-full flex flex-col items-center justify-center text-danger-400 space-y-3">
                    <AlertCircle className="w-8 h-8" />
                    <p className="text-sm font-semibold">{textError}</p>
                    <a
                      href={downloadUrl}
                      download={file.originalName}
                      className="px-4 py-2 bg-night-600 text-white rounded-xl font-sans text-xs font-bold shadow-card hover:bg-night-500 cursor-pointer"
                    >
                      Unduh Berkas Langsung
                    </a>
                  </div>
                ) : (
                  <div className="table w-full select-text">
                    {textLines.map((line, idx) => {
                      const isHighlighted =
                        textSearch.trim() !== "" &&
                        line.toLowerCase().includes(textSearch.toLowerCase());

                      return (
                        <div
                          key={idx}
                          className={`table-row hover:bg-night-900 transition-colors ${
                            isHighlighted ? "bg-warn-500/20 text-warn-200 font-bold" : ""
                          }`}
                        >
                          <div className="table-cell pr-4 text-right select-none text-night-600 font-mono text-[11px] w-12 shrink-0">
                            {idx + 1}
                          </div>
                          <div
                            className={`table-cell pl-2 text-night-200 ${
                              textWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
                            }`}
                          >
                            {line || " "}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. OFFICE / GOOGLE DOCS / OTHER FALLBACK */}
          {!isImage && !isVideo && !isAudio && !isPdf && !isText && (
            <div className="w-full max-w-xl bg-night-900 border border-night-800 rounded-2xl p-8 sm:p-10 shadow-float text-center space-y-6 animate-pop-in">
              <div className="w-20 h-20 rounded-2xl bg-night-500/10 border border-night-500/20 text-night-400 flex items-center justify-center mx-auto ">
                {isOfficeDoc ? (
                  <FileSpreadsheet className="w-10 h-10 text-ok-400" />
                ) : (
                  <FileArchive className="w-10 h-10 text-warn-400" />
                )}
              </div>

              <div>
                <h4 className="text-base font-bold text-white mb-1.5 truncate max-w-md mx-auto">
                  {file.originalName}
                </h4>
                <p className="text-xs text-night-400 max-w-sm mx-auto leading-relaxed">
                  {isOfficeDoc
                    ? "Dokumen perkantoran (Word, Excel, PowerPoint). Anda dapat membukanya langsung di Google Docs atau mengunduh dokumen ke perangkat."
                    : "Format berkas ini siap diunduh atau dipratinjau melalui penyimpanan cloud Google Drive."}
                </p>
              </div>

              {/* Metadata Card */}
              <div className="bg-night-950/80 border border-night-800/80 rounded-2xl p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center text-night-400">
                  <span>Ukuran Berkas:</span>
                  <span className="font-semibold text-night-200">{formatBytes(file.size)}</span>
                </div>
                <div className="flex justify-between items-center text-night-400">
                  <span>Tipe MIME:</span>
                  <span className="font-mono text-[11px] text-night-300">{file.mimeType || "application/octet-stream"}</span>
                </div>
                <div className="flex justify-between items-center text-night-400">
                  <span>Status Google Drive:</span>
                  {(() => {
                    const isFolderSynced = !!(file.folder?.syncToGoogleDrive && file.folder?.googleDriveFolderId);
                    if (!isFolderSynced || file.syncStatus === SyncStatus.LOCAL_ONLY) {
                      return (
                        <span className="font-semibold text-night-400 flex items-center gap-1">
                          Lokal Saja
                        </span>
                      );
                    }
                    const isSynced = file.syncStatus === SyncStatus.SYNCED;
                    return (
                      <span className={`font-semibold flex items-center gap-1 ${isSynced ? "text-ok-400" : "text-warn-400"}`}>
                        {isSynced ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {file.syncStatus}
                      </span>
                    );
                  })()}
                </div>
                <div className="pt-2 border-t border-night-800/60 flex items-center justify-between text-[11px] text-night-400">
                  <span className="font-mono truncate max-w-[200px]" title={file.checksumSha256}>
                    SHA256: {file.checksumSha256?.substring(0, 16)}...
                  </span>
                  <button
                    onClick={handleCopyHash}
                    className="text-night-400 hover:text-night-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedHash ? <Check className="w-3 h-3 text-ok-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedHash ? "Tersalin" : "Salin Hash"}</span>
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <a
                  href={downloadUrl}
                  download={file.originalName}
                  className="px-5 py-2.5 bg-night-600 hover:bg-night-500 text-white rounded-xl text-xs font-bold shadow-card active:scale-95 transition flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Unduh Berkas</span>
                </a>

                {file.googleDriveWebViewLink && (
                  <a
                    href={file.googleDriveWebViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-2.5 bg-night-800 hover:bg-night-700 text-night-200 border border-night-700 rounded-xl text-xs font-bold active:scale-95 transition flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4 text-night-400" />
                    <span>Buka di Google Drive</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER BAR */}
        <div className="h-10 px-6 bg-night-900 border-t border-night-800 flex items-center justify-between text-[11px] text-night-400 shrink-0 select-none">
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">Gunakan tombol panah ⬅ ➡ untuk berpindah berkas</span>
            <span>Tekan ESC untuk menutup</span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span>{file.mimeType}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
