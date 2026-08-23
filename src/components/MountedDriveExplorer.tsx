import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  HardDrive,
  Folder as FolderIcon,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Download,
  Eye,
  Play,
  Trash2,
  Upload,
  Plus,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  ChevronRight,
  ArrowLeft,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  FolderPlus,
  Cloud,
  Check,
  X,
  FileUp,
} from "lucide-react";
import { MountDrive, MountFileItem, MountBrowseResult, Folder, FileItem, SyncStatus } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useDialog } from "../context/DialogContext.tsx";
import { FilePreviewModal } from "./FilePreviewModal.tsx";
import { OperationLoadingModal, OperationType } from "./OperationLoadingModal.tsx";

interface MountedDriveExplorerProps {
  mount: MountDrive;
  folders: Folder[];
  onRefreshMounts: () => void;
}

export const MountedDriveExplorer: React.FC<MountedDriveExplorerProps> = ({
  mount,
  folders,
  onRefreshMounts,
}) => {
  const { showAlert, showConfirm, showToast } = useDialog();

  // Navigation state
  const [subPath, setSubPath] = useState<string>("");
  const [browseData, setBrowseData] = useState<MountBrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Action states
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [importingItem, setImportingItem] = useState<MountFileItem | null>(null);
  const [selectedTargetFolderId, setSelectedTargetFolderId] = useState<string>(folders[0]?.id || "");
  const [isImporting, setIsImporting] = useState<boolean>(false);

  // File Preview Modal State (converted to compatible FileItem interface)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // Operation loading modal
  const [operationLoading, setOperationLoading] = useState<{
    isOpen: boolean;
    title: string;
    message?: string;
    type?: OperationType;
    subMessage?: string;
  }>({ isOpen: false, title: "" });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load directory contents
  const loadDirectory = useCallback(
    async (path: string = "") => {
      setIsLoading(true);
      try {
        const data = await api.browseMountDirectory(mount.id, path);
        setBrowseData(data);
      } catch (err: any) {
        showAlert({
          title: "Gagal Membaca Direktori",
          message: err.message || "Tidak dapat memuat isi folder pada drive mount.",
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [mount.id, showAlert]
  );

  useEffect(() => {
    setSubPath("");
    setSearchTerm("");
    loadDirectory("");
  }, [mount.id, loadDirectory]);

  // Navigate into subfolder
  const handleNavigate = (newSubPath: string) => {
    setSubPath(newSubPath);
    setSearchTerm("");
    loadDirectory(newSubPath);
  };

  // Navigate up one level
  const handleNavigateUp = () => {
    if (!subPath) return;
    const parts = subPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = parts.join("/");
    handleNavigate(parentPath);
  };

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  // Get matching icon based on file flags
  const renderItemIcon = (item: MountFileItem) => {
    if (item.isDirectory) {
      return <FolderIcon className="w-5 h-5 text-amber-500 fill-amber-500/20" />;
    }
    if (item.isImage) return <ImageIcon className="w-5 h-5 text-purple-500" />;
    if (item.isVideo) return <Video className="w-5 h-5 text-rose-500" />;
    if (item.isAudio) return <Music className="w-5 h-5 text-emerald-500" />;
    if (item.isPdf) return <FileText className="w-5 h-5 text-red-500" />;
    if (item.isText) return <FileCode className="w-5 h-5 text-indigo-500" />;
    if (item.isOfficeDoc) return <FileSpreadsheet className="w-5 h-5 text-teal-500" />;
    if (item.isArchive) return <FileArchive className="w-5 h-5 text-amber-600" />;
    return <FileText className="w-5 h-5 text-slate-500" />;
  };

  // Filter items based on search query
  const rawItems = browseData?.items || [];
  const filteredItems = rawItems.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const directories = filteredItems.filter((i) => i.isDirectory);
  const files = filteredItems.filter((i) => !i.isDirectory);

  // Handle Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean) return;

    try {
      await api.createMountFolder(mount.id, subPath, clean);
      showToast(`Folder "${clean}" berhasil dibuat`, "success");
      setNewFolderName("");
      setIsCreatingFolder(false);
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Membuat Folder",
        message: err.message || "Terjadi kesalahan saat membuat folder.",
        type: "error",
      });
    }
  };

  // Handle File Upload
  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setIsUploading(true);
    try {
      const fileList = Array.from(selectedFiles) as File[];
      const res = await api.uploadToMount(mount.id, subPath, fileList);
      showToast(res.message || "Berkas berhasil diunggah", "success");
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengunggah",
        message: err.message || "Terjadi kesalahan saat mengunggah berkas.",
        type: "error",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Handle Delete Item
  const handleDeleteItem = async (item: MountFileItem) => {
    const isDir = item.isDirectory;
    const confirmed = await showConfirm({
      title: isDir ? "Hapus Folder" : "Hapus Berkas",
      message: `Yakin ingin menghapus ${isDir ? "folder" : "berkas"} "${item.name}" secara permanen dari sistem lokal /mnt?`,
      confirmText: "Ya, Hapus",
      cancelText: "Batal",
      isDanger: true,
    });
    if (!confirmed) return;

    setOperationLoading({
      isOpen: true,
      title: isDir ? "Menghapus Folder Permanen" : "Menghapus Berkas Permanen",
      message: item.name,
      type: "permanent_delete",
      subMessage: `Sedang menghapus ${isDir ? "folder" : "berkas"} dari sistem lokal...`,
    });
    try {
      await api.deleteMountItem(mount.id, item.relativePath);
      showToast(`"${item.name}" berhasil dihapus`, "success");
      loadDirectory(subPath);
      onRefreshMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menghapus",
        message: err.message || "Terjadi kesalahan saat menghapus item.",
        type: "error",
      });
    } finally {
      setOperationLoading((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Convert MountFileItem to FileItem for preview modal
  const handleOpenPreview = (item: MountFileItem) => {
    const viewUrl = api.getMountFileViewUrl(mount.id, item.relativePath);
    const downloadUrl = api.getMountFileDownloadUrl(mount.id, item.relativePath);

    const syntheticFile: FileItem & { _mountId?: string; _mountRelativePath?: string; _customViewUrl?: string; _customDownloadUrl?: string } = {
      id: item.id,
      folderId: "mounted-drive",
      userId: "local",
      originalName: item.name,
      storagePath: item.fullPath,
      size: item.size,
      mimeType: item.mimeType,
      checksumSha256: item.id,
      syncStatus: SyncStatus.SYNCED,
      syncAttempts: 0,
      createdAt: item.modifiedAt,
      updatedAt: item.modifiedAt,
      googleDriveWebViewLink: viewUrl,
      _mountId: mount.id,
      _mountRelativePath: item.relativePath,
      _customViewUrl: viewUrl,
      _customDownloadUrl: downloadUrl,
    };

    setPreviewFile(syntheticFile);
  };

  // Handle Import to Google Drive
  const handleExecuteImport = async () => {
    if (!importingItem || !selectedTargetFolderId) return;

    setIsImporting(true);
    try {
      const res = await api.importMountFileToDrive(
        mount.id,
        importingItem.relativePath,
        selectedTargetFolderId
      );
      showToast(res.message, "success");
      setImportingItem(null);
    } catch (err: any) {
      showAlert({
        title: "Gagal Mengimpor Berkas",
        message: err.message || "Terjadi kesalahan saat mengimpor berkas ke Google Drive.",
        type: "error",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      
      {/* 1. TOP DRIVE BANNER & METADATA */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Left: Drive Info */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 shadow-inner">
              <HardDrive className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-extrabold text-slate-900 tracking-tight truncate">
                  {mount.name}
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
                  {mount.mountPoint}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" />
                  Sistem Lokal Terpasang
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                <span>{mount.filesCount || 0} berkas</span>
                <span>•</span>
                <span>{mount.dirsCount || 0} subfolder</span>
                <span>•</span>
                <span>Total: {formatBytes(mount.totalBytes || 0)}</span>
              </p>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={handleUploadFiles}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>Unggah ke /mnt</span>
            </button>

            <button
              onClick={() => setIsCreatingFolder(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 active:scale-95 transition-all cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-slate-600" />
              <span>Folder Baru</span>
            </button>

            <button
              onClick={() => loadDirectory(subPath)}
              disabled={isLoading}
              className="p-2 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-all"
              title="Segarkan Direktori"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-indigo-600" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. BREADCRUMBS & FILTER TOOLBAR */}
      <div className="bg-white/80 border-b border-slate-200 px-6 py-2.5 flex items-center justify-between gap-4 shrink-0 flex-wrap">
        
        {/* Breadcrumb Path */}
        <div className="flex items-center gap-1.5 text-xs text-slate-600 overflow-x-auto py-1 min-w-0 max-w-full">
          {subPath && (
            <button
              onClick={handleNavigateUp}
              className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 mr-1"
              title="Kembali ke folder atas"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => handleNavigate("")}
            className={`font-semibold hover:text-indigo-600 transition-colors flex items-center gap-1 shrink-0 ${
              !subPath ? "text-indigo-600 font-bold" : "text-slate-700"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>{mount.name}</span>
          </button>

          {browseData?.breadcrumbs.slice(1).map((b, idx) => (
            <React.Fragment key={idx}>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <button
                onClick={() => handleNavigate(b.subPath)}
                className={`hover:text-indigo-600 transition-colors truncate max-w-[150px] shrink-0 ${
                  idx === browseData.breadcrumbs.length - 2
                    ? "text-indigo-600 font-bold"
                    : "text-slate-700 font-medium"
                }`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Search & Layout Toggles */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-48 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari dalam drive..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-100/90 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === "grid" ? "bg-white text-indigo-600 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-800"
              }`}
              title="Tampilan Kotak (Grid)"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === "list" ? "bg-white text-indigo-600 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-800"
              }`}
              title="Tampilan Daftar (List)"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. NEW FOLDER INLINE MODAL */}
      {isCreatingFolder && (
        <div className="bg-indigo-50/80 border-b border-indigo-100 px-6 py-3 flex items-center justify-between gap-4 animate-fade-in">
          <form onSubmit={handleCreateFolder} className="flex items-center gap-2.5 flex-1 max-w-md">
            <FolderPlus className="w-4 h-4 text-indigo-600 shrink-0" />
            <input
              type="text"
              placeholder="Nama folder baru..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full px-3 py-1.5 bg-white border border-indigo-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
            >
              Buat
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreatingFolder(false);
                setNewFolderName("");
              }}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
            >
              Batal
            </button>
          </form>
        </div>
      )}

      {/* 4. EXPLORER CONTENT BODY */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        
        {isLoading ? (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="h-44 flex flex-col items-center justify-center text-slate-500 bg-white border border-slate-200 rounded-3xl p-6 shadow-xs text-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3 shadow-2xs">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              </div>
              <p className="text-sm font-bold text-slate-800">Membaca Direktori Mount...</p>
              <p className="text-xs text-slate-400 mt-0.5">{mount.mountPoint} {subPath ? `/${subPath}` : ""}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-36 bg-white border border-slate-200/80 rounded-2xl p-3.5 animate-pulse shadow-2xs" />
              ))}
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-center p-8 bg-white border border-dashed border-slate-200 rounded-3xl space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-500 shadow-inner">
              <FolderIcon className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">Direktori Kosong</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                Tidak ada berkas atau folder dalam direktori ini. Anda dapat mengunggah berkas atau membuat folder baru.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md cursor-pointer"
              >
                Unggah Berkas Sekarang
              </button>
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Buat Folder
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* SUBDIRECTORIES SECTION */}
            {directories.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FolderIcon className="w-3.5 h-3.5 text-amber-500" />
                  <span>Folder ({directories.length})</span>
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {directories.map((dir) => (
                    <div
                      key={dir.id}
                      onClick={() => handleNavigate(dir.relativePath)}
                      className="group bg-white hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-2xl p-3.5 flex items-center justify-between gap-2.5 shadow-2xs hover:shadow-md transition-all cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FolderIcon className="w-6 h-6 text-amber-500 fill-amber-500/20 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-bold text-slate-800 truncate" title={dir.name}>
                          {dir.name}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteItem(dir);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all"
                        title="Hapus Folder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FILES SECTION */}
            {files.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Berkas ({files.length})</span>
                </h3>

                {viewMode === "grid" ? (
                  /* GRID VIEW */
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {files.map((file) => {
                      const viewUrl = api.getMountFileViewUrl(mount.id, file.relativePath);
                      const downloadUrl = api.getMountFileDownloadUrl(mount.id, file.relativePath);

                      return (
                        <div
                          key={file.id}
                          className="group bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl overflow-hidden shadow-2xs hover:shadow-lg transition-all flex flex-col justify-between"
                        >
                          {/* Thumbnail / Media Preview Area */}
                          <div
                            onClick={() => handleOpenPreview(file)}
                            className="h-32 bg-slate-100 flex items-center justify-center relative overflow-hidden cursor-pointer select-none"
                          >
                            {file.isImage ? (
                              <img
                                src={viewUrl}
                                alt={file.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const parent = e.currentTarget.parentElement;
                                  if (parent) {
                                    parent.innerHTML = `<div class="flex flex-col items-center justify-center text-purple-600 p-2"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></div>`;
                                  }
                                }}
                              />
                            ) : file.isVideo || file.mimeType?.startsWith("video/") || ["mp4", "webm", "mov", "mkv"].includes(file.extension?.toLowerCase() || "") ? (
                              <div className="w-full h-full relative bg-slate-900 flex items-center justify-center">
                                <video
                                  src={viewUrl}
                                  preload="metadata"
                                  muted
                                  playsInline
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                                <div className="absolute inset-0 bg-slate-950/30 flex items-center justify-center">
                                  <div className="w-8 h-8 rounded-full bg-black/60 border border-white/20 backdrop-blur-xs flex items-center justify-center text-white shadow-md group-hover:scale-110 group-hover:bg-purple-600 transition-all">
                                    <Play className="w-3.5 h-3.5 ml-0.5 fill-white" />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="w-12 h-12 rounded-2xl bg-white shadow-xs border border-slate-200 flex items-center justify-center group-hover:scale-110 transition-transform">
                                {renderItemIcon(file)}
                              </div>
                            )}

                            {/* Extension Tag */}
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-slate-900/70 text-white uppercase shadow-xs">
                              {file.extension || "FILE"}
                            </span>
                          </div>

                          {/* File Details & Actions */}
                          <div className="p-3">
                            <h4
                              onClick={() => handleOpenPreview(file)}
                              className="text-xs font-bold text-slate-800 truncate hover:text-indigo-600 transition-colors cursor-pointer"
                              title={file.name}
                            >
                              {file.name}
                            </h4>
                            <p className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-between">
                              <span>{formatBytes(file.size)}</span>
                              <span>{formatDate(file.modifiedAt)}</span>
                            </p>

                            {/* Action Buttons */}
                            <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 gap-1">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleOpenPreview(file)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                  title="Pratinjau Berkas"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <a
                                  href={downloadUrl}
                                  download={file.name}
                                  className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                                  title="Unduh Berkas"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>

                              <div className="flex items-center gap-1">
                                {/* Import to Google Drive Button */}
                                <button
                                  onClick={() => {
                                    setImportingItem(file);
                                    if (folders.length > 0) {
                                      setSelectedTargetFolderId(folders[0].id);
                                    }
                                  }}
                                  className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                  title="Impor &amp; Sinkronkan ke Google Drive"
                                >
                                  <UploadCloud className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  onClick={() => handleDeleteItem(file)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Hapus Berkas"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* LIST VIEW */
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                          <th className="py-3 px-4">Nama Berkas</th>
                          <th className="py-3 px-4">Ukuran</th>
                          <th className="py-3 px-4">Tipe MIME</th>
                          <th className="py-3 px-4">Waktu Modifikasi</th>
                          <th className="py-3 px-4 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {files.map((file) => {
                          const downloadUrl = api.getMountFileDownloadUrl(mount.id, file.relativePath);

                          return (
                            <tr key={file.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-3 px-4 font-semibold text-slate-800">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div
                                    onClick={() => handleOpenPreview(file)}
                                    className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer hover:bg-indigo-50 transition-colors"
                                  >
                                    {renderItemIcon(file)}
                                  </div>
                                  <span
                                    onClick={() => handleOpenPreview(file)}
                                    className="truncate hover:text-indigo-600 transition-colors cursor-pointer"
                                    title={file.name}
                                  >
                                    {file.name}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                                {formatBytes(file.size)}
                              </td>
                              <td className="py-3 px-4 font-mono text-[11px] text-slate-500 truncate max-w-[140px]">
                                {file.mimeType}
                              </td>
                              <td className="py-3 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                                {formatDate(file.modifiedAt)}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => handleOpenPreview(file)}
                                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                    title="Pratinjau"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <a
                                    href={downloadUrl}
                                    download={file.name}
                                    className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                    title="Unduh"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                  <button
                                    onClick={() => {
                                      setImportingItem(file);
                                      if (folders.length > 0) {
                                        setSelectedTargetFolderId(folders[0].id);
                                      }
                                    }}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                    title="Impor ke Google Drive"
                                  >
                                    <UploadCloud className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(file)}
                                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Hapus"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. IMPORT TO GOOGLE DRIVE MODAL */}
      {importingItem && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setImportingItem(null);
          }}
        >
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-slate-800 animate-scale-up">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Impor ke Google Drive</h3>
                  <p className="text-xs text-slate-500">Salin dari <code className="font-mono text-indigo-700">{mount.mountPoint}</code></p>
                </div>
              </div>
              <button
                onClick={() => setImportingItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs space-y-1.5">
                <div className="font-bold text-slate-800 truncate">{importingItem.name}</div>
                <div className="text-slate-500 flex items-center justify-between">
                  <span>Ukuran: {formatBytes(importingItem.size)}</span>
                  <span>Tipe: {importingItem.extension.toUpperCase()}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Pilih Folder Tujuan Aplikasi
                </label>
                {folders.length === 0 ? (
                  <p className="text-xs text-rose-500">Belum ada folder aplikasi yang tersedia.</p>
                ) : (
                  <select
                    value={selectedTargetFolderId}
                    onChange={(e) => setSelectedTargetFolderId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  >
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.targetFolderPath})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  Berkas akan disalin ke buffer lokal dan otomatis dijadwalkan untuk sinkronisasi ke folder Google Drive tujuan.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setImportingItem(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isImporting || folders.length === 0}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-500/20 active:scale-95 transition-all inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isImporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Cloud className="w-4 h-4" />
                  )}
                  <span>Mulai Impor &amp; Sinkron</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. FILE PREVIEW MODAL */}
      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      {/* 7. OPERATION LOADING MODAL */}
      <OperationLoadingModal {...operationLoading} />
    </div>
  );
};
