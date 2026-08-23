import React, { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import { DialogProvider } from "./context/DialogContext.tsx";
import { TransferProvider } from "./context/TransferContext.tsx";
import { TransferHUD } from "./components/TransferHUD.tsx";
import { GoogleDriveLayout } from "./components/GoogleDriveLayout.tsx";
import { AuthView } from "./components/AuthView.tsx";
import { PublicSharedFolderView } from "./components/PublicSharedFolderView.tsx";
import {
  Folder,
  FileItem,
  GoogleDriveStatus,
  StorageStats,
  SyncStats,
} from "./types/frontend.ts";
import { api } from "./services/api.ts";
import { Loader2 } from "lucide-react";

function MainApp() {
  const { user, isAdmin, isLoading: isAuthLoading } = useAuth();

  // Check if opening via share link (?folderId=...&perm=...&sig=...)
  const [shareParams] = useState<{
    folderId: string | null;
    perm: string | null;
    sig: string | null;
  }>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        folderId: params.get("folderId") || params.get("folder"),
        perm: params.get("perm") || params.get("permission"),
        sig: params.get("sig") || params.get("signature") || params.get("token"),
      };
    } catch {
      return { folderId: null, perm: null, sig: null };
    }
  });

  const [forceShowLogin, setForceShowLogin] = useState<boolean>(false);

  // Global State
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleDriveStatus | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);

  const fetchGlobalData = useCallback(async () => {
    try {
      const [foldersRes, filesRes, googleRes, storageRes, syncRes] = await Promise.all([
        api.listFolders(),
        api.listFiles(),
        api.getGoogleStatus(),
        api.getStorageStats(),
        api.getSyncStats(),
      ]);

      setFolders(foldersRes.folders);
      setFiles(filesRes.files);
      setGoogleStatus(googleRes);
      setStorageStats(storageRes);
      setSyncStats(syncRes);
    } catch (err) {
      console.warn("Error refreshing global data:", err);
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  // Initial load when user exists
  useEffect(() => {
    if (user) {
      fetchGlobalData();
    }
  }, [user, fetchGlobalData]);

  // Periodic polling for sync updates (every 4 seconds)
  // useEffect(() => {
  //   if (!user) return;
  //   const interval = setInterval(() => {
  //     api.listFiles().then((res) => setFiles(res.files)).catch(() => {});
  //     api.getSyncStats().then((res) => setSyncStats(res)).catch(() => {});
  //     api.getStorageStats().then((res) => setStorageStats(res)).catch(() => {});
  //   }, 4000);
  //   return () => clearInterval(interval);
  // }, [user]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-300">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-sm font-medium">Memuat Power Drive...</p>
        </div>
      </div>
    );
  }

  // 1. If unauthenticated AND a valid share folderId is present in URL, open Public Shared Folder directly!
  if (!user && shareParams.folderId && !forceShowLogin) {
    return (
      <>
        <PublicSharedFolderView
          initialFolderId={shareParams.folderId}
          permParam={shareParams.perm}
          signatureParam={shareParams.sig}
          onGoToLogin={() => setForceShowLogin(true)}
        />
        <TransferHUD />
      </>
    );
  }

  // 2. If unauthenticated, show Auth Portal (Login, Register, Forgot Password, Reset Password)
  if (!user) {
    return (
      <AuthView
        onSuccess={fetchGlobalData}
        onBackToSharedFolder={
          shareParams.folderId ? () => setForceShowLogin(false) : undefined
        }
      />
    );
  }

  return (
    <>
      <GoogleDriveLayout
        folders={folders}
        files={files}
        googleStatus={googleStatus}
        storageStats={storageStats}
        syncStats={syncStats}
        onRefreshAll={fetchGlobalData}
        isInitialLoading={isInitialLoading}
      />
      <TransferHUD />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DialogProvider>
        <TransferProvider>
          <MainApp />
        </TransferProvider>
      </DialogProvider>
    </AuthProvider>
  );
}
