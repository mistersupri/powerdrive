import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrandingApplier } from "@/lib/branding";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router";
import { queryClient } from "@/lib/query";
import { ForgotPage, LoginPage, RegisterPage, ResetPage } from "@/features/auth/AuthPages";
import { AppShell } from "@/features/layout/Shell";
import { AllFilesPage, ResultsPage, StoragePage } from "@/features/files/FilesPages";
import { Spinner } from "@/ui/misc";

// The file manager is the landing experience and ships in the main chunk; the rest load on demand.
const Dashboard = lazy(() => import("@/features/dashboard/DashboardPage"));
const Transfers = lazy(() => import("@/features/dashboard/TransfersPage"));
const StorageAdmin = lazy(() => import("@/features/storage/StoragePageAdmin"));
const Dual = lazy(() => import("@/features/dual/DualPanePage"));
const Settings = lazy(() => import("@/features/settings/SettingsPage"));
const Members = lazy(() => import("@/features/members/MembersPage").then((m) => ({ default: m.MembersPage })));
const Trash = lazy(() => import("@/features/trash/TrashPage"));
const Shares = lazy(() => import("@/features/share/SharesPage"));
const PublicShare = lazy(() => import("@/features/share/PublicSharePage"));
const AdminSettings = lazy(() => import("@/features/settings/AdminSettingsPage"));
const Media = lazy(() => import("@/features/files/MediaPage"));
const SharedWithMe = lazy(() => import("@/features/share/SharedWithMePage"));
const DirectShare = lazy(() => import("@/features/share/SharedWithMePage").then((m) => ({ default: m.DirectSharePage })));
const Activity = lazy(() => import("@/features/members/MembersPage").then((m) => ({ default: m.ActivityPage })));

const L = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<div className="grid flex-1 place-items-center"><Spinner className="size-6" /></div>}>{children}</Suspense>;

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> }, { path: "/register", element: <RegisterPage /> },
  { path: "/forgot-password", element: <ForgotPage /> }, { path: "/reset-password", element: <ResetPage /> },
  // Public share links: no login, no app shell.
  { path: "/share/:token", element: <L><PublicShare /></L> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <L><Dashboard /></L> },
      { path: "files", element: <AllFilesPage /> },
      { path: "s/:storageId", element: <StoragePage /> },
      { path: "recent", element: <ResultsPage mode="recent" /> }, { path: "starred", element: <ResultsPage mode="starred" /> }, { path: "search", element: <ResultsPage mode="search" /> },
      { path: "trash", element: <L><Trash /></L> }, { path: "admin", element: <L><AdminSettings /></L> }, { path: "media", element: <L><Media /></L> }, { path: "shared", element: <L><SharedWithMe /></L> }, { path: "shared/:id", element: <L><DirectShare /></L> }, { path: "shares", element: <L><Shares /></L> },
      { path: "transfers", element: <L><Transfers /></L> }, { path: "storage", element: <L><StorageAdmin /></L> }, { path: "dual", element: <L><Dual /></L> },
      { path: "activity", element: <L><Activity /></L> }, { path: "members", element: <L><Members /></L> }, { path: "settings", element: <L><Settings /></L> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() { return <QueryClientProvider client={queryClient}><BrandingApplier /><RouterProvider router={router} /></QueryClientProvider>; }
