import React, { useState } from "react";
import {
  Cloud,
  HardDrive,
  ShieldCheck,
  UserCheck,
  LogOut,
  RefreshCw,
  Server,
  FolderSync,
  Layers,
  ChevronDown,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";
import { DriveType, GoogleDriveStatus, StorageStats, UserRole } from "../types/frontend.ts";

interface HeaderProps {
  googleStatus: GoogleDriveStatus | null;
  storageStats: StorageStats | null;
  onRefreshStats: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  googleStatus,
  storageStats,
  onRefreshStats,
  onOpenSettings,
}) => {
  const { user, isAdmin, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-4">
          
          {/* Brand Identity */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center shadow-md shadow-blue-500/25 shrink-0 border border-blue-400/30">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300 fill-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white truncate">
                  Power Drive
                </h1>
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  Cloud &amp; Sync
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Portal Unggah Terpusat &amp; Sinkronisasi Google Drive
              </p>
            </div>
          </div>

          {/* Quick Metrics & System States */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            
            {/* Google Drive Status Pill */}
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition-colors text-xs font-medium"
              title="Klik untuk konfigurasi Google Drive"
            >
              <div className="relative">
                <Cloud className="w-4 h-4 text-emerald-400" />
                <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse" />
              </div>
              <span className="hidden sm:inline text-slate-300">
                {googleStatus?.driveType === DriveType.SHARED_DRIVE ? "Shared Drive" : "My Drive"}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                Terkoneksi
              </span>
            </button>

            {/* Storage Buffer Stats */}
            {storageStats && (
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/40 text-xs text-slate-300">
                <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                <span>Buffer:</span>
                <span className="font-semibold text-slate-200">
                  {storageStats.totalSizeFormatted}
                </span>
                <span className="text-slate-500">({storageStats.totalFiles} berkas)</span>
              </div>
            )}

            {/* Refresh Metrics Button */}
            <button
              onClick={onRefreshStats}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
              title="Muat Ulang Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* User Profile / Role Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 border border-slate-700 transition-all text-xs font-medium"
              >
                <div className="w-6 h-6 rounded-md bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-semibold text-xs">
                  {user?.name.charAt(0) || "U"}
                </div>
                <div className="hidden md:block text-left">
                  <div className="text-slate-200 font-medium leading-none">{user?.name || "Pengguna"}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-slate-850 bg-slate-900 border border-slate-750 shadow-2xl py-2 z-50 text-xs">
                  <div className="px-3.5 py-2 border-b border-slate-800">
                    <p className="font-medium text-slate-200">{user?.name}</p>
                    <p className="text-slate-400 text-[11px] truncate">{user?.email}</p>
                  </div>

                  <div className="border-t border-slate-800 pt-1.5 px-2">
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors text-left"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Keluar (Logout)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};
