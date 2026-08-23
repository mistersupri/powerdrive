import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import {
  Folder,
  FileItem,
  GoogleDriveStatus,
  StorageStats,
  SyncStats,
  FolderPermission,
  SyncStatus,
  MountDrive,
} from "../types/frontend.ts";
import { GoogleDriveExplorer } from "./GoogleDriveExplorer.tsx";
import { DriveSettingsView } from "./DriveSettingsView.tsx";
import { MountedDriveExplorer } from "./MountedDriveExplorer.tsx";
import { CreateMountModal } from "./CreateMountModal.tsx";
import { TrashView } from "./TrashView.tsx";
import { api } from "../services/api.ts";
import {
  FolderSync,
  HardDrive,
  Users,
  Clock,
  Settings,
  Shield,
  UploadCloud,
  FolderPlus,
  LogOut,
  User as UserIcon,
  ChevronDown,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cloud,
  ExternalLink,
  Plus,
  ShieldCheck,
  Zap,
  Share2,
  Menu,
  X,
  Layers,
  Trash2,
} from "lucide-react";

export type DriveSidebarTab =
  | "my_drive"
  | "shared_with_me"
  | "trash"
  | "settings"
  | `mount_${string}`;

interface GoogleDriveLayoutProps {
  folders: Folder[];
  files: FileItem[];
  googleStatus: GoogleDriveStatus | null;
  storageStats: StorageStats | null;
  syncStats: SyncStats | null;
  onRefreshAll: () => void;
  isInitialLoading?: boolean;
}

export const GoogleDriveLayout: React.FC<GoogleDriveLayoutProps> = ({
  folders,
  files,
  googleStatus,
  storageStats,
  syncStats,
  onRefreshAll,
  isInitialLoading = false,
}) => {
  const { user, isAdmin, logout } = useAuth();
  const { showAlert, showToast } = useDialog();
  const [activeTab, setActiveTab] = useState<DriveSidebarTab>("my_drive");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isTriggeringSync, setIsTriggeringSync] = useState(false);
  const [sharedBanner, setSharedBanner] = useState<string | null>(null);

  // Mounted Drives (/mnt) state
  const [mounts, setMounts] = useState<MountDrive[]>([]);
  const [selectedMountId, setSelectedMountId] = useState<string | null>(null);
  const [isScanningMounts, setIsScanningMounts] = useState<boolean>(false);
  const [isCreateMountOpen, setIsCreateMountOpen] = useState<boolean>(false);
  const [trashCount, setTrashCount] = useState<number>(0);

  const newMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Load trash stats to show badge count
  const loadTrashStats = useCallback(async () => {
    try {
      const res = await api.getTrash();
      const count = (res.files?.length || 0) + (res.folders?.length || 0);
      setTrashCount(count);
    } catch {
      // ignore
    }
  }, []);

  // Load mounted drives from server
  const loadMounts = useCallback(async () => {
    setIsScanningMounts(true);
    try {
      const res = await api.listMounts();
      setMounts(res.mounts || []);
    } catch (err: any) {
      console.warn("Could not load mounts:", err);
    } finally {
      setIsScanningMounts(false);
    }
  }, []);

  useEffect(() => {
    loadMounts();
    loadTrashStats();
  }, [loadMounts, loadTrashStats]);

  // Handle shared link query parameters (?folderId=...&perm=...)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedFolderId = params.get("folderId");
      const permParam = params.get("perm");
      if (sharedFolderId) {
        setCurrentFolderId(sharedFolderId);
        setActiveTab("my_drive");
        setSharedBanner(
          `Folder dibuka melalui tautan bagikan khusus (${
            permParam === "VIEW" ? "Izin: Hanya Lihat / VIEW" : "Izin: Bisa Mengedit / EDIT"
          })`
        );
        setTimeout(() => setSharedBanner(null), 8000);
      }
    } catch {
      // ignore
    }
  }, []);

  // Filter for shared folders
  const sharedFolders = folders.filter((f) => f.ownerId && f.ownerId !== user?.id);

  // Storage calculation
  const usedBytes = storageStats?.totalSizeBytes || 0;
  const maxBytes = 15 * 1024 * 1024 * 1024; // 15 GB Google standard tier
  const usagePercent = Math.min(100, Math.max(1, (usedBytes / maxBytes) * 100));

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const handleTriggerSync = async () => {
    setIsTriggeringSync(true);
    try {
      await api.triggerSyncQueue();
      showToast("Sinkronisasi latar belakang berhasil dipicu", "info");
      onRefreshAll();
      loadMounts();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menyinkronkan",
        message: err.message,
        type: "error",
      });
    } finally {
      setIsTriggeringSync(false);
    }
  };

  const pendingFilesCount = files.filter(
    (f) =>
      f.syncStatus === SyncStatus.PENDING ||
      f.syncStatus === SyncStatus.PROCESSING ||
      f.syncStatus === SyncStatus.RETRYING
  ).length;

  const currentSelectedMount = mounts.find((m) => m.id === selectedMountId) || mounts[0];

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-slate-100 flex flex-col font-sans text-slate-900">
      
      {/* 1. TOP HEADER (Power Drive Style) */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2.5 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 border border-blue-400/30 shrink-0">
            <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300 fill-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">
                Power Drive
              </span>
            </div>
          </div>
        </div>

        {/* Right Status & Account Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Sync Trigger Button */}
          {pendingFilesCount > 0 && (
            <button
              onClick={handleTriggerSync}
              disabled={isTriggeringSync}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold border border-blue-200 transition-all cursor-pointer"
              title="Sinkronkan semua berkas antrean ke Google Drive"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTriggeringSync ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Sinkron ({pendingFilesCount})</span>
            </button>
          )}

          {/* User Profile Dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-100 transition-all border border-transparent hover:border-slate-200"
            >
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-slate-300 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                  {user?.name ? user.name.substring(0, 2).toUpperCase() : "SP"}
                </div>
              )}
              <div className="text-left hidden lg:block">
                <div className="text-xs font-bold text-slate-800 truncate max-w-[130px]">
                  {user?.name || "Pengguna"}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* User Menu Popup */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-50 animate-fade-in text-xs">
                <div className="p-2 border-b border-slate-100 mb-2">
                  <div className="font-bold text-slate-900">{user?.name}</div>
                  <div className="text-slate-500 truncate">{user?.email}</div>
                </div>

                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setActiveTab("settings");
                  }}
                  className="w-full flex items-center gap-2 p-2 rounded-xl text-slate-700 hover:bg-slate-100 font-medium"
                >
                  <Settings className="w-4 h-4 text-slate-500" />
                  <span>Pengaturan & Akun</span>
                </button>

                <div className="border-t border-slate-100 mt-2 pt-2">
                  <button
                    id="btn-logout"
                    onClick={() => {
                      setShowUserMenu(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 p-2 rounded-xl text-rose-600 hover:bg-rose-50 font-bold"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Keluar / Ganti Akun</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. BODY LAYOUT: LEFT SIDEBAR + MAIN CONTENT CANVAS */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT SIDEBAR (Google Drive Style) */}
        <aside className="w-56 sm:w-64 bg-white border-r border-slate-200 p-4 flex flex-col justify-between shrink-0 hidden md:flex overflow-y-auto">
          <div className="space-y-5">
            {/* Main Navigation Links */}
            <nav className="space-y-1 text-xs font-semibold">
              <button
                onClick={() => {
                  setActiveTab("my_drive");
                  setCurrentFolderId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  activeTab === "my_drive"
                    ? "bg-blue-50 text-blue-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <HardDrive className="w-4 h-4 text-blue-600" />
                <span>Drive Saya</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab("shared_with_me");
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
                  activeTab === "shared_with_me"
                    ? "bg-blue-50 text-blue-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span>Dibagikan kepada Saya</span>
                </div>
                {sharedFolders.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 text-slate-700">
                    {sharedFolders.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("trash")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
                  activeTab === "trash"
                    ? "bg-rose-50 text-rose-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="w-4 h-4 text-rose-500" />
                  <span>Sampah &amp; Pemulihan</span>
                </div>
                {trashCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                    {trashCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("settings")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  activeTab === "settings"
                    ? "bg-blue-50 text-blue-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Settings className="w-4 h-4 text-slate-600" />
                <span>Pengaturan &amp; Google Drive</span>
              </button>
            </nav>

            {/* MOUNTED DRIVES (/mnt) SIDEBAR SECTION */}
            {mounts.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between px-3 py-1.5 mb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Drive Terpasang (/mnt)</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={loadMounts}
                      disabled={isScanningMounts}
                      className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title="Pindai Ulang Mount (/mnt)"
                    >
                      <RefreshCw className={`w-3 h-3 ${isScanningMounts ? "animate-spin text-indigo-600" : ""}`} />
                    </button>
                    <button
                      onClick={() => setIsCreateMountOpen(true)}
                      className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title="Tambah Mount Point Baru"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1 text-xs font-semibold">
                  {mounts.map((mount) => {
                    const isTabActive = activeTab === `mount_${mount.id}`;
                    return (
                      <button
                        key={mount.id}
                        onClick={() => {
                          setSelectedMountId(mount.id);
                          setActiveTab(`mount_${mount.id}`);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left ${
                          isTabActive
                            ? "bg-indigo-50 text-indigo-700 font-bold shadow-2xs"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            isTabActive ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                          }`}>
                            <HardDrive className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold leading-tight">
                              {mount.name}
                            </div>
                            <div className="truncate text-[10px] font-mono text-slate-400">
                              {mount.mountPoint}
                            </div>
                          </div>
                        </div>
                        {mount.filesCount !== undefined && (
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] shrink-0 ${
                            isTabActive ? "bg-indigo-200/80 text-indigo-900" : "bg-slate-200/80 text-slate-600"
                          }`}>
                            {mount.filesCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* MAIN VIEWPORT CANVAS */}
        <main className="flex-1 bg-slate-50 overflow-y-auto flex flex-col pb-16 md:pb-0">
          {sharedBanner && (
            <div className="bg-blue-600 text-white px-6 py-2.5 text-xs font-semibold flex items-center justify-between shadow-xs sticky top-0 z-20 animate-fade-in">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-blue-200" />
                <span>{sharedBanner}</span>
              </div>
              <button
                onClick={() => setSharedBanner(null)}
                className="text-blue-200 hover:text-white p-1 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {activeTab === "my_drive" && (
            <GoogleDriveExplorer
              folders={folders}
              files={files}
              googleStatus={googleStatus}
              storageStats={storageStats}
              syncStats={syncStats}
              currentFolderId={currentFolderId}
              onNavigateFolder={setCurrentFolderId}
              onRefreshData={onRefreshAll}
              isLoading={isInitialLoading}
              onOpenSettings={() => setActiveTab("settings")}
            />
          )}

          {activeTab.startsWith("mount_") && currentSelectedMount && (
            <MountedDriveExplorer
              mount={currentSelectedMount}
              folders={folders}
              onRefreshMounts={() => {
                loadMounts();
                onRefreshAll();
              }}
            />
          )}

          {activeTab === "shared_with_me" && (
            <div className="p-6 space-y-6 max-w-6xl w-full mx-auto">
              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600" />
                  Folder &amp; Dokumen Dibagikan kepada Saya
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Folder dari staf atau pengguna lain dengan hak akses izin yang telah ditentukan (Edit / Hanya Lihat).
                </p>
              </div>

              {sharedFolders.length === 0 ? (
                <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center">
                  <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-700">
                    Belum ada folder yang dibagikan oleh pengguna lain
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Semua folder yang Anda buat dapat diakses pada menu "Drive Saya".
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {sharedFolders.map((folder) => (
                    <div
                      key={folder.id}
                      onClick={() => {
                        setCurrentFolderId(folder.id);
                        setActiveTab("my_drive");
                      }}
                      className="bg-white border border-slate-200 hover:border-emerald-400 p-4 rounded-2xl cursor-pointer shadow-xs hover:shadow-md transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            folder.permission === FolderPermission.VIEW
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {folder.permission === FolderPermission.VIEW ? "Hanya Lihat" : "Bisa Edit"}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {folder.filesCount || 0} berkas
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm truncate mb-1">
                        {folder.name}
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Pemilik: <strong>{folder.ownerName || "Staf Lain"}</strong>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "trash" && (
            <TrashView
              onRefreshAll={() => {
                onRefreshAll();
                loadTrashStats();
              }}
            />
          )}

          {activeTab === "settings" && (
            <div className="p-4 sm:p-6 max-w-6xl w-full mx-auto">
              <DriveSettingsView
                googleStatus={googleStatus}
                storageStats={storageStats}
                syncStats={syncStats}
                folders={folders}
                mounts={mounts}
                onRefreshAll={onRefreshAll}
              />
            </div>
          )}
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR (Clean 1-tap navigation on mobile, no sidebar needed) */}
      <nav className="md:hidden bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-30 px-2 py-1.5 flex items-center justify-around shadow-lg">
        <button
          type="button"
          onClick={() => {
            setActiveTab("my_drive");
            setCurrentFolderId(null);
          }}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl text-[10px] font-semibold transition-all cursor-pointer ${
            activeTab === "my_drive" ? "text-blue-600 font-bold" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <HardDrive className={`w-5 h-5 mb-0.5 ${activeTab === "my_drive" ? "text-blue-600 stroke-[2.5]" : "text-slate-400"}`} />
          <span>Drive Saya</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("shared_with_me")}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl text-[10px] font-semibold transition-all cursor-pointer relative ${
            activeTab === "shared_with_me" ? "text-blue-600 font-bold" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Users className={`w-5 h-5 mb-0.5 ${activeTab === "shared_with_me" ? "text-blue-600 stroke-[2.5]" : "text-slate-400"}`} />
          <span>Dibagikan</span>
          {sharedFolders.length > 0 && (
            <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-emerald-500"></span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("trash")}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl text-[10px] font-semibold transition-all cursor-pointer relative ${
            activeTab === "trash" ? "text-rose-600 font-bold" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Trash2 className={`w-5 h-5 mb-0.5 ${activeTab === "trash" ? "text-rose-600 stroke-[2.5]" : "text-slate-400"}`} />
          <span>Sampah</span>
          {trashCount > 0 && (
            <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-rose-500"></span>
          )}
        </button>

        {mounts.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setActiveTab(`mount_${mounts[0].id}` as DriveSidebarTab);
              setSelectedMountId(mounts[0].id);
            }}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl text-[10px] font-semibold transition-all cursor-pointer ${
              activeTab.startsWith("mount_") ? "text-indigo-600 font-bold" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Layers className={`w-5 h-5 mb-0.5 ${activeTab.startsWith("mount_") ? "text-indigo-600 stroke-[2.5]" : "text-slate-400"}`} />
            <span>/mnt</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl text-[10px] font-semibold transition-all cursor-pointer ${
            activeTab === "settings" ? "text-blue-600 font-bold" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Settings className={`w-5 h-5 mb-0.5 ${activeTab === "settings" ? "text-blue-600 stroke-[2.5]" : "text-slate-400"}`} />
          <span>Pengaturan</span>
        </button>
      </nav>

      {/* CREATE MOUNT MODAL */}
      <CreateMountModal
        isOpen={isCreateMountOpen}
        onClose={() => setIsCreateMountOpen(false)}
        onMountCreated={() => {
          loadMounts();
        }}
      />
    </div>
  );
};

