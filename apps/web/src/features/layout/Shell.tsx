import type { NotificationDto, StorageConnectionDto } from "@superdrive/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRightLeft, Bell, Check, ChevronsUpDown, Clock, Columns2, FolderOpen, HardDrive, LayoutDashboard, Link2, LogOut, Menu as MenuIcon, Moon, Search, Settings, Star, Sun, Trash2, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { Toaster } from "sonner";
import { api, onUnauthorized, setWorkspaceId } from "@/lib/api";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { queryClient } from "@/lib/query";
import { useMe, useWorkspace } from "@/features/auth/useAuth";
import { connectTransfers, disconnectTransfers, transferStore } from "@/features/transfers/store";
import { FloatingProgress } from "@/features/transfers/FloatingProgress";
import { Avatar, Skeleton } from "@/ui/misc";
import { IconButton } from "@/ui/Button";
import { useMenu } from "@/ui/Menu";
import { Logo } from "./Logo";
import { startTransfer } from "@/features/files/transferApi";
import { DRAG_MIME } from "@/features/files/dnd";
import { toast } from "sonner";
import { useTheme } from "./theme";

export function useStorages() {
  return useQuery({ queryKey: ["storages"], queryFn: () => api<StorageConnectionDto[]>("/storages"), staleTime: 15_000 });
}

const item = "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink";
const active = "bg-primary-soft text-primary-ink hover:bg-primary-soft";

function NavItem({ to, icon: Icon, children, badge, end }: { to: string; icon: typeof Search; children: ReactNode; badge?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn(item, isActive && active)}>
      {({ isActive }) => (<>
        {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-primary" aria-hidden />}
        <Icon className="size-[18px] shrink-0" aria-hidden />
        <span className="flex-1 truncate">{children}</span>
        {!!badge && <span className="tnum rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-white">{badge}</span>}
      </>)}
    </NavLink>
  );
}
const Section = ({ children }: { children: ReactNode }) => <div className="mt-5 mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">{children}</div>;

const PROVIDER_DOT: Record<string, string> = { GOOGLE_DRIVE: "bg-[#4285F4]", ONEDRIVE: "bg-[#0078D4]", DROPBOX: "bg-[#0061FF]", LOCAL: "bg-ok-ink", S3: "bg-warn-ink", SMB: "bg-violet-ink", SFTP: "bg-primary-ink", WEBDAV: "bg-danger-ink" };

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const storages = useStorages().data ?? [];
  const { isAdmin } = useWorkspace();
  const activeCount = transferStore.use((s) => s.jobs.filter((j) => ["QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING"].includes(j.status)).length);
  return (
    <nav aria-label="Navigasi utama" className="flex h-full flex-col" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      <div className="px-5 pt-5 pb-3"><Logo /></div>
      <WorkspaceSwitcher />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <NavItem to="/" end icon={LayoutDashboard}>Beranda</NavItem>
        <Section>Berkas</Section>
        <NavItem to="/files" icon={FolderOpen}>Semua file</NavItem>
        <NavItem to="/recent" icon={Clock}>Terbaru</NavItem>
        <NavItem to="/starred" icon={Star}>Berbintang</NavItem>
        <NavItem to="/shares" icon={Link2}>Tautan berbagi</NavItem>
        <NavItem to="/trash" icon={Trash2}>Sampah</NavItem>
        <Section>Penyimpanan</Section>
        {storages.filter((s) => !s.isDefault).map((s) => (
          <NavLink key={s.id} to={`/s/${s.id}`} className={({ isActive }) => cn(item, "h-8", isActive && active)}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.currentTarget.classList.add("ring-2", "ring-primary"); } }}
            onDragLeave={(e) => e.currentTarget.classList.remove("ring-2", "ring-primary")}
            onDrop={(e) => { e.currentTarget.classList.remove("ring-2", "ring-primary"); const raw = e.dataTransfer.getData(DRAG_MIME); if (!raw) return; e.preventDefault(); const p = JSON.parse(raw); void startTransfer(e.altKey ? "COPY" : "MOVE", p.storageId, p.ids, { storageId: s.id, folderId: "root", folderName: s.name }).catch((er) => toast.error((er as Error).message)); }}>
            <span className={cn("ml-1.5 size-2 shrink-0 rounded-full", PROVIDER_DOT[s.provider] ?? "bg-faint", s.status !== "CONNECTED" && "opacity-40")} aria-hidden />
            <span className="flex-1 truncate">{s.name}</span>
            {s.status !== "CONNECTED" && <span className="size-1.5 rounded-full bg-warn-ink" title="Perlu perhatian" role="img" aria-label="Perlu perhatian" />}
          </NavLink>
        ))}
        <NavItem to="/storage" icon={HardDrive}>Kelola penyimpanan</NavItem>
        <Section>Operasi</Section>
        <NavItem to="/transfers" icon={ArrowRightLeft} badge={activeCount}>Transfer</NavItem>
        <NavItem to="/dual" icon={Columns2}>Salin dua panel</NavItem>
        {isAdmin && <NavItem to="/activity" icon={Activity}>Log aktivitas</NavItem>}
        <Section>Workspace</Section>
        <NavItem to="/members" icon={Users}>Anggota</NavItem>
        <NavItem to="/settings" icon={Settings}>Pengaturan</NavItem>
      </div>
    </nav>
  );
}

function WorkspaceSwitcher() {
  const me = useMe().data; const { workspace } = useWorkspace(); const menu = useMenu(); const nav = useNavigate();
  if (!me || !workspace) return <div className="px-4 pb-2"><Skeleton className="h-10" /></div>;
  return (
    <div className="px-3 pb-2">
      <button className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu.open(r.left, r.bottom + 4, [
          ...me.workspaces.map((w) => ({ label: w.name, icon: w.id === workspace.id ? <Check /> : undefined, onSelect: () => { if (w.id !== workspace.id) { setWorkspaceId(w.id); queryClient.clear(); disconnectTransfers(); connectTransfers(); nav("/"); location.reload(); } } })),
        ]); }}>
        <span className="grid size-7 place-items-center rounded-md bg-navy text-[12px] font-bold text-white">{workspace.name[0]?.toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{workspace.name}</span><span className="block text-[11px] text-muted">{({ OWNER: "Pemilik", ADMIN: "Admin", MEMBER: "Anggota", VIEWER: "Pembaca" } as const)[workspace.role]}</span></span>
        <ChevronsUpDown className="size-4 text-muted" aria-hidden />
      </button>
      {menu.element}
    </div>
  );
}

/** Title bar used by every page: title, subtitle, page actions, then global search + notifications + account. */
export function PageHeader({ title, subtitle, actions, onMenu }: { title: string; subtitle?: string; actions?: ReactNode; onMenu?: () => void }) {
  const ctx = useShell();
  return (
    <header className="flex min-h-[68px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-8">
      <IconButton label="Buka menu" className="lg:hidden" onClick={onMenu ?? ctx.openMenu}><MenuIcon className="size-5" /></IconButton>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[20px] leading-tight font-bold">{title}</h1>
        {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
      <div className="flex items-center gap-2"><GlobalSearch /><Notifications /><AccountMenu /></div>
    </header>
  );
}

function GlobalSearch() {
  const nav = useNavigate(); const ref = useRef<HTMLInputElement>(null); const [q, setQ] = useState("");
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []);
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}
      className="hidden h-9 w-56 items-center gap-2 rounded-lg bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-primary/30 md:flex">
      <Search className="size-4 text-faint" aria-hidden />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari file" placeholder="Cari file…" className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-muted focus:outline-none" />
      <kbd className="text-[11px] text-faint">⌘K</kbd>
    </form>
  );
}

function Notifications() {
  const qc = useQueryClient(); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: NotificationDto[]; unread: number }>("/notifications"), refetchInterval: 60_000, staleTime: 20_000 });
  useEffect(() => {
    if (!open) return;
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", d); addEventListener("keydown", k); return () => { removeEventListener("mousedown", d); removeEventListener("keydown", k); };
  }, [open]);
  const unread = q.data?.unread ?? 0;
  return (
    <div ref={ref} className="relative">
      <IconButton label={unread ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"} onClick={() => { setOpen((o) => !o); if (!open && unread) void api("/notifications/read", { body: {} }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })); void qc.invalidateQueries({ queryKey: ["notifications"] }); }} className="bg-surface-2">
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger ring-2 ring-surface-2" aria-hidden />}
      </IconButton>
      {open && (
        <div className="anim-pop absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-line bg-surface shadow-float">
          <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">Notifikasi</div>
          <ul className="scroll-thin max-h-[420px] divide-y divide-line overflow-y-auto">
            {q.data?.items.length ? q.data.items.map((n) => (
              <li key={n.id} className="px-4 py-3"><p className="text-[13px] font-medium">{n.title}</p><p className="text-[12px] text-muted">{n.message}</p><p className="mt-0.5 text-[11px] text-faint">{timeAgo(n.createdAt)}</p></li>
            )) : <li className="px-4 py-10 text-center text-[13px] text-muted">Belum ada notifikasi.</li>}
          </ul>
        </div>)}
    </div>
  );
}

function AccountMenu() {
  const { user } = useWorkspace(); const menu = useMenu(); const nav = useNavigate(); const { theme, toggle } = useTheme();
  return (<>
    <button aria-label="Menu akun" aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu.open(r.right - 200, r.bottom + 6, [
      { label: user?.email ?? "", onSelect: () => {}, disabled: true },
      { label: theme === "dark" ? "Tema terang" : "Tema gelap", icon: theme === "dark" ? <Sun /> : <Moon />, onSelect: toggle, divider: true },
      { label: "Pengaturan", icon: <Settings />, onSelect: () => nav("/settings") },
      { label: "Keluar", icon: <LogOut />, danger: true, divider: true, onSelect: async () => { await api("/auth/logout", { body: {} }).catch(() => {}); disconnectTransfers(); queryClient.clear(); nav("/login", { replace: true }); } },
    ]); }} className="rounded-full transition-transform active:scale-95"><Avatar name={user?.name ?? "?"} /></button>
    {menu.element}
  </>);
}

import { createContext, useContext } from "react";
const ShellCtx = createContext<{ openMenu: () => void }>({ openMenu: () => {} });
const useShell = () => useContext(ShellCtx);

export function AppShell() {
  const me = useMe(); const nav = useNavigate(); const loc = useLocation(); const [drawer, setDrawer] = useState(false);
  useEffect(() => onUnauthorized(() => { queryClient.clear(); nav(`/login?next=${encodeURIComponent(loc.pathname)}`, { replace: true }); }), [nav, loc.pathname]);
  useEffect(() => { if (me.data) { connectTransfers(); return disconnectTransfers; } }, [me.data]);
  useEffect(() => setDrawer(false), [loc.pathname]);

  if (me.isLoading) return <div className="grid h-dvh place-items-center"><div className="flex items-center gap-3 text-muted"><Logo /></div></div>;
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return (
    <ShellCtx.Provider value={{ openMenu: () => setDrawer(true) }}>
      <div className="flex h-dvh">
        <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block"><Sidebar /></aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="anim-slide-up absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-float"><IconButton label="Tutup menu" className="absolute top-4 right-3 z-10" onClick={() => setDrawer(false)}><X className="size-5" /></IconButton><Sidebar onNavigate={() => setDrawer(false)} /></aside>
          </div>)}
        <div className="flex min-w-0 flex-1 flex-col"><Outlet /></div>
        <FloatingProgress />
        <Toaster position="bottom-left" toastOptions={{ classNames: { toast: "!rounded-xl !border-line !bg-surface !text-ink !shadow-float" } }} />
      </div>
    </ShellCtx.Provider>
  );
}
