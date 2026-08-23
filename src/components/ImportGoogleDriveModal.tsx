import React, { useState, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  CloudDownload,
  Search,
  ChevronRight,
  Home,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Link as LinkIcon,
  RefreshCw,
  FolderTree,
  FileText,
  Sparkles,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { Folder as FolderType, GoogleDriveNode } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { useDialog } from "../context/DialogContext.tsx";
import { getCachedGoogleAccessToken } from "../lib/google-auth.ts";

interface ImportGoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (importedFolder: FolderType) => void;
  currentFolderId: string | null;
  existingFolders: FolderType[];
}

export const ImportGoogleDriveModal: React.FC<ImportGoogleDriveModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentFolderId,
  existingFolders,
}) => {
  const { showAlert, showToast } = useDialog();

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Mode: "browser" (Explore hierarchy) or "direct" (Paste URL/ID)
  const [activeTab, setActiveTab] = useState<"browser" | "direct">("browser");

  // Navigation inside Google Drive
  const [gdriveBreadcrumbs, setGdriveBreadcrumbs] = useState<Array<{ id: string; name: string }>>([
    { id: "root", name: "Drive Saya" },
  ]);
  const [currentGdriveParentId, setCurrentGdriveParentId] = useState<string>("root");
  const [gdriveFolders, setGdriveFolders] = useState<GoogleDriveNode[]>([]);
  const [currentGdriveFiles, setCurrentGdriveFiles] = useState<Array<{ id: string; name: string; mimeType: string; size?: number; webViewLink?: string }>>([]);
  const [isLoadingGdriveFolders, setIsLoadingGdriveFolders] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Selected Google Drive folder to import
  const [selectedGdriveFolder, setSelectedGdriveFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Direct URL / ID input
  const [directInput, setDirectInput] = useState<string>("");
  const [isValidatingDirect, setIsValidatingDirect] = useState<boolean>(false);

  // Folder preview details
  const [folderPreview, setFolderPreview] = useState<{
    id: string;
    name: string;
    description?: string;
    subfolders: Array<{ id: string; name: string }>;
    files: Array<{ id: string; name: string; mimeType: string; size?: number }>;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);

  // Target in App
  const [targetParentFolderId, setTargetParentFolderId] = useState<string>(currentFolderId || "");
  const [customFolderName, setCustomFolderName] = useState<string>("");

  // Import State
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTargetParentFolderId(currentFolderId || "");
      loadGdriveFolders("root");
      setGdriveBreadcrumbs([{ id: "root", name: "Drive Saya" }]);
      setCurrentGdriveParentId("root");
      setGdriveFolders([]);
      setCurrentGdriveFiles([]);
      setSelectedGdriveFolder(null);
      setFolderPreview(null);
      setDirectInput("");
      setCustomFolderName("");
      setErrorMessage(null);
    }
  }, [isOpen, currentFolderId]);

  const loadGdriveFolders = async (parentId: string, search?: string) => {
    setIsLoadingGdriveFolders(true);
    setErrorMessage(null);
    try {
      const token = getCachedGoogleAccessToken() || undefined;
      const res = await api.getGoogleFolderContents(parentId, token);
      
      let foldersList = res.subfolders || [];
      let filesList = res.files || [];
      
      if (search) {
        const query = search.toLowerCase();
        foldersList = foldersList.filter(f => f.name.toLowerCase().includes(query));
        filesList = filesList.filter(f => f.name.toLowerCase().includes(query));
      }
      
      setGdriveFolders(foldersList.map(f => ({ 
        id: f.id, 
        name: f.name, 
        mimeType: "application/vnd.google-apps.folder" 
      })));
      setCurrentGdriveFiles(filesList);
    } catch (err: any) {
      console.warn("Failed to get Google Drive folder contents:", err);
      setGdriveFolders([]);
      setCurrentGdriveFiles([]);
    } finally {
      setIsLoadingGdriveFolders(false);
    }
  };

  const handleNavigateGdrive = (folder: { id: string; name: string }) => {
    setCurrentGdriveParentId(folder.id);
    const existingIdx = gdriveBreadcrumbs.findIndex((b) => b.id === folder.id);
    if (existingIdx >= 0) {
      setGdriveBreadcrumbs(gdriveBreadcrumbs.slice(0, existingIdx + 1));
    } else {
      setGdriveBreadcrumbs([...gdriveBreadcrumbs, folder]);
    }
    loadGdriveFolders(folder.id);

    // Otomatis pilih folder yang sedang dibuka jika bukan root
    if (folder.id !== "root") {
      handleSelectFolder(folder);
    } else {
      setSelectedGdriveFolder(null);
      setFolderPreview(null);
      setCustomFolderName("");
    }
  };

  const handleSelectFolder = async (folder: { id: string; name: string }) => {
    setSelectedGdriveFolder(folder);
    setCustomFolderName(folder.name);
    setErrorMessage(null);

    // Fetch folder preview details
    setIsLoadingPreview(true);
    try {
      const token = getCachedGoogleAccessToken() || undefined;
      const preview = await api.getGoogleFolderContents(folder.id, token);
      setFolderPreview(preview);
    } catch (err: any) {
      console.warn("Failed to load folder preview:", err);
      setFolderPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const extractFolderIdFromInput = (input: string): string => {
    const trimmed = input.trim();
    // Case 1: https://drive.google.com/drive/folders/1ABCDEF... or https://drive.google.com/drive/u/0/folders/1ABCDEF...
    const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    // Case 2: id=1ABCDEF...
    const paramMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (paramMatch && paramMatch[1]) {
      return paramMatch[1];
    }
    // Case 3: Raw ID
    return trimmed;
  };

  const handleValidateDirectInput = async () => {
    const extractedId = extractFolderIdFromInput(directInput);
    if (!extractedId) {
      setErrorMessage("Masukkan tautan atau ID folder Google Drive yang valid.");
      return;
    }

    setIsValidatingDirect(true);
    setErrorMessage(null);
    try {
      const token = getCachedGoogleAccessToken() || undefined;
      const preview = await api.getGoogleFolderContents(extractedId, token);
      setSelectedGdriveFolder({ id: preview.id, name: preview.name });
      setCustomFolderName(preview.name);
      setFolderPreview(preview);
    } catch (err: any) {
      setErrorMessage(err.message || "Folder Google Drive tidak ditemukan atau tidak dapat diakses.");
      setSelectedGdriveFolder(null);
      setFolderPreview(null);
    } finally {
      setIsValidatingDirect(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGdriveFolder) {
      setErrorMessage("Silakan pilih folder Google Drive yang ingin diimpor terlebih dahulu.");
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const token = getCachedGoogleAccessToken() || undefined;
      const res = await api.importGoogleFolder({
        googleFolderId: selectedGdriveFolder.id,
        parentAppFolderId: targetParentFolderId || null,
        customName: customFolderName.trim() || selectedGdriveFolder.name,
        accessToken: token,
      });

      showToast(
        `Berhasil mengimpor folder "${res.folder.name}" (${res.totalFoldersImported} folder, ${res.totalFilesImported} berkas).`,
        "success"
      );
      onSuccess(res.folder);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Gagal mengimpor folder dari Google Drive.");
      showAlert({
        title: "Gagal Mengimpor Folder",
        message: err.message || "Terjadi kesalahan saat mengimpor folder dari Google Drive.",
        type: "error",
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
              <CloudDownload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Import Folder dari Google Drive</h3>
              <p className="text-xs text-slate-500">
                Pilih folder dari Google Drive untuk diimpor beserta subfolder dan berkas di dalamnya.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-6 pt-3 bg-white gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("browser");
              setErrorMessage(null);
            }}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "browser"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <FolderTree className="w-4 h-4" />
            <span>Jelajahi Drive Saya</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("direct");
              setErrorMessage(null);
            }}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "direct"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>Tautan / ID Folder</span>
          </button>
        </div>

        {/* Modal Body with Scroll */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeTab === "browser" ? (
            <div className="space-y-3">
              {/* Google Drive Breadcrumbs & Search Toolbar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-1 overflow-x-auto text-xs py-1 scrollbar-thin">
                  {gdriveBreadcrumbs.map((crumb, idx) => {
                    const isLast = idx === gdriveBreadcrumbs.length - 1;
                    return (
                      <React.Fragment key={crumb.id}>
                        {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                        <button
                          type="button"
                          onClick={() => handleNavigateGdrive(crumb)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors shrink-0 ${
                            isLast
                              ? "font-bold text-slate-900 bg-white shadow-2xs"
                              : "text-slate-600 hover:text-emerald-700 hover:bg-slate-200/60"
                          }`}
                        >
                          {idx === 0 ? <Home className="w-3.5 h-3.5 text-emerald-600" /> : <Folder className="w-3.5 h-3.5 text-amber-500" />}
                          <span>{crumb.name}</span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1 sm:w-48">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Cari folder Drive..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        loadGdriveFolders(currentGdriveParentId, e.target.value);
                      }}
                      className="w-full pl-8 pr-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => loadGdriveFolders(currentGdriveParentId, searchQuery)}
                    className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 cursor-pointer"
                    title="Segarkan Folder Google Drive"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGdriveFolders ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Google Drive Folder List Box */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
                {isLoadingGdriveFolders ? (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                    <span className="text-xs">Memuat daftar folder Google Drive...</span>
                  </div>
                ) : (gdriveFolders.length === 0 && currentGdriveFiles.length === 0) ? (
                  <div className="py-10 text-center text-slate-400">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-semibold">Tidak ada isi (subfolder/berkas) ditemukan di lokasi ini</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Anda dapat memilih folder saat ini atau beralih ke tab Tautan / ID.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {/* Folders (Selectable & Openable) */}
                    {gdriveFolders.map((folder) => {
                      const isSelected = selectedGdriveFolder?.id === folder.id;
                      return (
                        <div
                          key={folder.id}
                          onClick={() => handleSelectFolder(folder)}
                          className={`flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer ${
                            isSelected ? "bg-emerald-50/80 border-l-4 border-emerald-600" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Folder className={`w-4 h-4 shrink-0 ${isSelected ? "text-emerald-600" : "text-amber-500"}`} />
                            <span className={`text-xs font-semibold truncate ${isSelected ? "text-emerald-950" : "text-slate-800"}`}>
                              {folder.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {isSelected && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Dipilih
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNavigateGdrive(folder);
                              }}
                              className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-emerald-700 hover:bg-slate-200 rounded-md transition-colors border border-slate-200 bg-white shadow-3xs"
                              title="Masuk ke dalam folder ini"
                            >
                              Buka &rarr;
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Files (Disabled / Read-Only preview inside the opened folder) */}
                    {currentGdriveFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between px-4 py-2 bg-slate-50/50 text-slate-400 border-t border-slate-100 cursor-not-allowed opacity-80"
                        title="Berkas ini dibaca-saja dan akan diimpor otomatis bersama folder induknya"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-medium truncate select-none pointer-events-none">
                            {file.name}
                          </span>
                          {file.size !== undefined && file.size > 0 && (
                            <span className="text-[10px] text-slate-400 font-mono">({formatFileSize(file.size)})</span>
                          )}
                        </div>

                        <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-md font-medium select-none">
                          Hanya Baca (Disabled)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Direct Link / ID Tab */
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-700">
                Tempel Tautan atau ID Folder Google Drive
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Contoh: https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoP... atau 1aBcDeFgHiJkLmNoP"
                    value={directInput}
                    onChange={(e) => setDirectInput(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleValidateDirectInput}
                  disabled={isValidatingDirect || !directInput.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  {isValidatingDirect ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>Periksa Folder</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Pastikan folder tersebut dapat diakses oleh akun Google Drive yang terhubung dengan portal.
              </p>
            </div>
          )}

          {/* Selected Folder Preview Box */}
          {selectedGdriveFolder && (
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3 animate-fadeIn">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
                    <Folder className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                      <span>Folder Terpilih:</span>
                      <span className="text-emerald-800">{selectedGdriveFolder.name}</span>
                    </h4>
                    <p className="text-[11px] text-emerald-700 font-mono">
                      ID: {selectedGdriveFolder.id}
                    </p>
                  </div>
                </div>

                {isLoadingPreview ? (
                  <div className="flex items-center gap-1 text-[11px] text-emerald-700">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Memeriksa isi folder...</span>
                  </div>
                ) : folderPreview ? (
                  <div className="text-right">
                    <span className="inline-block px-2.5 py-0.5 bg-emerald-200/80 text-emerald-900 rounded-md text-[10px] font-bold">
                      {folderPreview.subfolders.length} subfolder &bull; {folderPreview.files.length} berkas
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Files are now fully visible inside the opened folder in the explorer above */}

              {/* Import Configuration Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-200/60">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nama Folder di Aplikasi
                  </label>
                  <input
                    type="text"
                    value={customFolderName}
                    onChange={(e) => setCustomFolderName(e.target.value)}
                    placeholder="Nama folder..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Simpan di dalam Folder
                  </label>
                  <select
                    value={targetParentFolderId}
                    onChange={(e) => setTargetParentFolderId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800 cursor-pointer"
                  >
                    <option value="">Drive Saya (Root Utama)</option>
                    {existingFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.targetFolderPath || f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Batal
          </button>

          <button
            type="button"
            onClick={handleImportSubmit}
            disabled={isImporting || !selectedGdriveFolder}
            className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-sm shadow-emerald-600/20 flex items-center gap-2 transition-all cursor-pointer"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mengimpor Folder &amp; Berkas...</span>
              </>
            ) : (
              <>
                <CloudDownload className="w-4 h-4" />
                <span>Mulai Import Folder</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
