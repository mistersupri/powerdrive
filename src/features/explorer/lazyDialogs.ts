import { lazy } from "react";

// Dialogs that are opened on demand. Each becomes its own chunk, so opening the
// explorer only downloads the grid itself.
export const FilePreviewModal = lazy(() => import("../../components/FilePreviewModal.tsx").then((m) => ({ default: m.FilePreviewModal })));
export const ShareFolderModal = lazy(() => import("../../components/ShareFolderModal.tsx").then((m) => ({ default: m.ShareFolderModal })));
export const ItemDetailsDrawer = lazy(() => import("../../components/ItemDetailsDrawer.tsx").then((m) => ({ default: m.ItemDetailsDrawer })));
export const ImportGoogleDriveModal = lazy(() =>
  import("../../components/ImportGoogleDriveModal.tsx").then((m) => ({ default: m.ImportGoogleDriveModal }))
);
export const MultiPartZipModal = lazy(() => import("../../components/MultiPartZipModal.tsx").then((m) => ({ default: m.MultiPartZipModal })));
export const FileConflictModal = lazy(() => import("../../components/FileConflictModal.tsx").then((m) => ({ default: m.FileConflictModal })));
export const MoveCopyModal = lazy(() => import("../../components/MoveCopyModal.tsx").then((m) => ({ default: m.MoveCopyModal })));
export const MoveCopyMountModal = lazy(() => import("../../components/MoveCopyMountModal.tsx").then((m) => ({ default: m.MoveCopyMountModal })));
