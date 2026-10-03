import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { HardDrive, Loader2, LogOut, Plus, RefreshCw, Server, Settings, Trash2, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";
import { useDialog } from "../context/DialogContext.tsx";
import { Folder, GoogleDriveStatus, MountDrive, StorageStats, SyncStats } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { cn } from "../lib/cn.ts";
import { formatBytes } from "../lib/format.ts";
import { GoogleDriveExplorer } from "../features/drive/GoogleDriveExplorer.tsx";
import { SharedWithMeView } from "../features/drive/SharedWithMeView.tsx";
import { Button, IconButton } from "../ui/Button.tsx";
import { DropdownMenu } from "../ui/Menu.tsx";
import { ThemeToggle } from "../ui/ThemeToggle.tsx";
import { Wordmark } from "../ui/Wordmark.tsx";
import { Dialog, DialogBody, DialogHeader } from "../ui/Dialog.tsx";
import { CreateMountModal } from "./CreateMountModal.tsx";

// Views that are not on the first screen load on demand to keep the initial bundle small.
const MountedDriveExplorer = lazy(() =>
  import("../features/mounts/MountedDriveExplorer.tsx").then((m) => ({ default: m.MountedDriveExplorer }))
);
const TrashView = lazy(() => import("./TrashView.tsx").then((m) => ({ default: m.TrashView })));
const DriveSettingsView = lazy(() => import("./DriveSettingsView.tsx").then((m) => ({ default: m.DriveSettingsView })));

export type DriveSidebarTab = "my_drive" | "shared_with_me" | "trash" | "settings" | `mount_${string}`;

interface GoogleDriveLayoutProps {
  folders: Folder[];
  googleStatus: GoogleDriveStatus | null;
  storageStats: StorageStats | null;
  syncStats: SyncStats | null;
  onRefreshAll: () => void;
}

function ViewFallback() {
  return (
    <div className="flex-1 flex items-center justify-center py-24 text-ink-500" role="status">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="sr-only">Memuat</span>
    </div>
  );
}

export const GoogleDriveLayout: React.FC<GoogleDriveLayoutProps> = ({ folders, googleStatus, storageStats, syncStats, onRefreshAll }) => {
  const { user, isAdmin, logout } = useAuth();
  const { showAlert, showToast } = useDialog();
  const [activeTab, setActiveTab] = useState<DriveSidebarTab>("my_drive");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [isTriggeringSync, setIsTriggeringSync] = useState(false);
  const [mounts, setMounts] = useState<MountDrive[]>([]);
  const [isScanningMounts, setIsScanningMounts] = useState(false);
  const [isCreateMountOpen, setIsCreateMountOpen] = useState(false);
  const [isMountPickerOpen, setIsMountPickerOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

  const loadTrashStats = useCallback(async () => {
    try {
      const res = await api.getTrash();
      setTrashCount((res.files?.length || 0) + (res.folders?.length || 0));
    } catch {
      // The badge is informational; the Trash view reports its own errors.
    }
  }, []);

  const loadMounts = useCallback(async () => {
    setIsScanningMounts(true);
    try {
      const res = await api.listMounts();
      setMounts(res.mounts || []);
    } catch (err) {
      console.warn("Could not load mounts:", err);
    } finally {
      setIsScanningMounts(false);
    }
  }, []);

  useEffect(() => {
    loadMounts();
    loadTrashStats();
  }, [loadMounts, loadTrashStats]);

  useEffect(() => {
    const onRefresh = () => loadTrashStats();
    window.addEventListener("powerdrive:refresh-data", onRefresh);
    return () => window.removeEventListener("powerdrive:refresh-data", onRefresh);
  }, [loadTrashStats]);

  const sharedFolders = folders.filter((f) => f.ownerId && f.ownerId !== user?.id);
  const pendingSync = storageStats?.pendingSyncCount ?? 0;
  const activeMount = activeTab.startsWith("mount_") ? mounts.find((m) => `mount_${m.id}` === activeTab) : undefined;

  const goTo = (tab: DriveSidebarTab) => {
    setActiveTab(tab);
    if (tab === "my_drive") setCurrentFolderId(null);
  };

  const handleTriggerSync = async () => {
    setIsTriggeringSync(true);
    try {
      await api.triggerSyncQueue();
      showToast("Antrean sinkronisasi diproses", "info");
      onRefreshAll();
    } catch (err: any) {
      showAlert({ title: "Sinkronisasi gagal dimulai", message: err.message, type: "error" });
    } finally {
      setIsTriggeringSync(false);
    }
  };

  const navItem = (tab: DriveSidebarTab, label: string, icon: React.ReactNode, count?: number) => {
    const active = activeTab === tab;
    return (
      <button
        type="button"
        onClick={() => goTo(tab)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "w-full flex items-center gap-3 h-10 px-3 rounded-lg text-sm transition-colors",
          active ? "bg-accent-600 text-accent-fg font-semibold" : "text-ink-600 font-medium hover:bg-ink-100 hover:text-ink-900"
        )}
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>
        <span className="flex-1 text-left truncate">{label}</span>
        {!!count && <span className={cn("text-xs font-semibold tabular", active ? "text-accent-fg/70" : "text-ink-500")}>{count}</span>}
      </button>
    );
  };

  const tabButton = (tab: DriveSidebarTab | "mounts", label: string, icon: React.ReactNode, dot?: boolean) => {
    const active = tab === "mounts" ? activeTab.startsWith("mount_") : activeTab === tab;
    return (
      <button
        type="button"
        onClick={() => {
          if (tab !== "mounts") return goTo(tab);
          if (mounts.length === 1) goTo(`mount_${mounts[0].id}`);
          else setIsMountPickerOpen(true);
        }}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex-1 flex flex-col items-center justify-center gap-1 h-14 text-[11px] font-semibold transition-colors",
          active ? "text-ink-900" : "text-ink-500"
        )}
      >
        <span className={cn("w-12 h-7 rounded-full flex items-center justify-center transition-colors", active && "bg-ink-100")}>{icon}</span>
        <span>{label}</span>
        {dot && <span className="absolute top-2 right-[calc(50%-18px)] w-2 h-2 rounded-full bg-danger-500" />}
      </button>
    );
  };

  return (
    <div className="h-dvh flex flex-col bg-canvas text-ink-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-surface focus:px-3 focus:py-2 focus:rounded-lg"
      >
        Lewati ke konten
      </a>

      <header className="h-14 shrink-0 bg-canvas border-b border-ink-200 px-3 sm:px-5 flex items-center justify-between gap-3">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-1.5">
          {pendingSync > 0 && activeTab === "my_drive" && (
            <Button
              size="sm"
              icon={<RefreshCw className={cn("w-4 h-4", isTriggeringSync && "animate-spin")} />}
              onClick={handleTriggerSync}
              disabled={isTriggeringSync}
              title="Proses antrean sinkronisasi ke Google Drive sekarang"
            >
              <span className="hidden sm:inline">Sinkronkan</span>
              <span className="tabular">{pendingSync}</span>
            </Button>
          )}
          <ThemeToggle />
          <DropdownMenu
            header={
              <div className="px-3 py-3 border-b border-ink-100">
                <div className="text-sm font-semibold text-ink-900 truncate">{user?.name}</div>
                <div className="text-xs text-ink-500 truncate">{user?.email}</div>
              </div>
            }
            items={[
              { label: "Pengaturan & akun", icon: <Settings className="w-4 h-4" />, onSelect: () => goTo("settings") },
              { label: "Keluar", icon: <LogOut className="w-4 h-4" />, danger: true, separated: true, onSelect: logout },
            ]}
            trigger={({ toggle, open, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Menu akun"
                className="pressable flex items-center gap-2 h-10 pl-1 pr-1 lg:pr-3 rounded-full hover:bg-ink-100"
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-ink-200 text-ink-800 text-xs font-bold flex items-center justify-center">
                    {(user?.name || "?").trim().slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden lg:block text-sm font-semibold text-ink-800 max-w-[10rem] truncate">{user?.name}</span>
              </button>
            )}
          />
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="hidden md:flex w-60 shrink-0 flex-col gap-6 border-r border-ink-200 px-3 py-4 overflow-y-auto">
          <nav aria-label="Navigasi utama" className="space-y-0.5">
            {navItem("my_drive", "Drive Saya", <HardDrive className="w-4 h-4" />)}
            {navItem("shared_with_me", "Dibagikan", <Users className="w-4 h-4" />, sharedFolders.length)}
            {navItem("trash", "Sampah", <Trash2 className="w-4 h-4" />, trashCount)}
            {navItem("settings", "Pengaturan", <Settings className="w-4 h-4" />)}
          </nav>

          {(mounts.length > 0 || isAdmin) && (
            <div>
              <div className="flex items-center justify-between pl-3 pr-1 mb-1">
                <h2 className="text-xs font-semibold text-ink-500 whitespace-nowrap">Server /mnt</h2>
                <div className="flex items-center">
                  <IconButton label="Pindai ulang penyimpanan" size="sm" onClick={loadMounts} disabled={isScanningMounts}>
                    <RefreshCw className={cn("w-3.5 h-3.5", isScanningMounts && "animate-spin")} />
                  </IconButton>
                  {isAdmin && (
                    <IconButton label="Tambah penyimpanan" size="sm" onClick={() => setIsCreateMountOpen(true)}>
                      <Plus className="w-4 h-4" />
                    </IconButton>
                  )}
                </div>
              </div>
              {mounts.length === 0 ? (
                <p className="px-3 text-xs text-ink-500 leading-relaxed">Belum ada penyimpanan /mnt yang dipasang.</p>
              ) : (
                <div className="space-y-0.5">
                  {mounts.map((m) => {
                    const active = activeTab === `mount_${m.id}`;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => goTo(`mount_${m.id}`)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "w-full flex items-center gap-3 h-11 px-3 rounded-lg text-left transition-colors",
                          active ? "bg-accent-600 text-accent-fg" : "text-ink-700 hover:bg-ink-100"
                        )}
                      >
                        <Server className="w-4 h-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold truncate leading-tight">{m.name}</span>
                          <span className={cn("block text-[11px] font-mono truncate", active ? "text-accent-fg/70" : "text-ink-500")}>
                            {m.mountPoint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {storageStats && (
            <div className="mt-auto px-3 text-xs text-ink-500 leading-relaxed">
              <span className="font-semibold text-ink-700 tabular">{formatBytes(storageStats.totalSizeBytes)}</span> di server
              <br />
              <span className="tabular">{storageStats.totalFiles}</span> berkas tersimpan
            </div>
          )}
        </aside>

        <main id="main" className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {activeTab === "my_drive" && (
            <GoogleDriveExplorer
              folders={folders}
              googleStatus={googleStatus}
              currentFolderId={currentFolderId}
              onNavigateFolder={setCurrentFolderId}
              onRefreshData={onRefreshAll}
            />
          )}

          {activeTab === "shared_with_me" && (
            <SharedWithMeView
              folders={sharedFolders}
              onOpen={(id) => {
                setCurrentFolderId(id);
                setActiveTab("my_drive");
              }}
            />
          )}

          <Suspense fallback={<ViewFallback />}>
            {activeMount && (
              <MountedDriveExplorer
                key={activeMount.id}
                mount={activeMount}
                onRefreshMounts={() => {
                  loadMounts();
                  onRefreshAll();
                }}
              />
            )}
            {activeTab.startsWith("mount_") && !activeMount && !isScanningMounts && (
              <div className="p-6 text-sm text-ink-500">Penyimpanan ini tidak lagi tersedia.</div>
            )}
            {activeTab === "trash" && (
              <div className="flex-1 overflow-y-auto pb-24 md:pb-6">
                <TrashView
                  onRefreshAll={() => {
                    onRefreshAll();
                    loadTrashStats();
                  }}
                />
              </div>
            )}
            {activeTab === "settings" && (
              <div className="flex-1 overflow-y-auto">
                <div className="p-4 sm:p-6 pb-28 md:pb-8 max-w-6xl w-full mx-auto">
                  <DriveSettingsView
                    googleStatus={googleStatus}
                    storageStats={storageStats}
                    syncStats={syncStats}
                    folders={folders}
                    mounts={mounts}
                    onRefreshAll={onRefreshAll}
                  />
                </div>
              </div>
            )}
          </Suspense>
        </main>
      </div>

      <nav
        aria-label="Navigasi utama"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-canvas border-t border-ink-200 flex pb-[env(safe-area-inset-bottom)]"
      >
        {tabButton("my_drive", "Drive", <HardDrive className="w-5 h-5" />)}
        {tabButton("shared_with_me", "Dibagikan", <Users className="w-5 h-5" />)}
        {mounts.length > 0 && tabButton("mounts", "Server", <Server className="w-5 h-5" />)}
        {tabButton("trash", "Sampah", <Trash2 className="w-5 h-5" />, trashCount > 0)}
        {tabButton("settings", "Akun", <Settings className="w-5 h-5" />)}
      </nav>

      <Dialog open={isMountPickerOpen} onClose={() => setIsMountPickerOpen(false)} size="sm">
        <DialogHeader title="Penyimpanan server" onClose={() => setIsMountPickerOpen(false)} />
        <DialogBody className="pb-5 space-y-1">
          {mounts.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setIsMountPickerOpen(false);
                goTo(`mount_${m.id}`);
              }}
              className="w-full flex items-center gap-3 h-14 px-3 rounded-xl text-left hover:bg-ink-100"
            >
              <Server className="w-5 h-5 text-ink-600" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-900 truncate">{m.name}</span>
                <span className="block text-xs font-mono text-ink-500 truncate">{m.mountPoint}</span>
              </span>
            </button>
          ))}
        </DialogBody>
      </Dialog>

      <CreateMountModal isOpen={isCreateMountOpen} onClose={() => setIsCreateMountOpen(false)} onMountCreated={loadMounts} />
    </div>
  );
};
