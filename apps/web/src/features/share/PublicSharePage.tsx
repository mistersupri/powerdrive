import { startDownload } from "@/lib/download";
import type { FileEntry, FileListing, PublicShareDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Eye, FolderPlus, Grid2x2, KeyRound, Link2Off, List, Pencil, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Toaster, toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePersistentState } from "@/lib/usePersistentState";
import { FileBrowser } from "@/features/files/FileBrowser";
import { DeleteDialog, NameDialog } from "@/features/files/dialogs";
import { applyFilter, emptyFilter, FilterButton, FilterChips } from "@/features/files/filter";
import { useSelection } from "@/features/files/selection";
import { FileUrlsProvider } from "@/features/files/urls";
import { sortEntries, type SortState } from "@/features/files/useFolder";
import { Logo } from "@/features/layout/Logo";
import { Preview } from "@/features/preview/Preview";
import { FloatingProgress } from "@/features/transfers/FloatingProgress";
import { enqueueUploads, type UploadInput } from "@/features/uploads/manager";
import { previewable } from "@/lib/fileType";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { useMenu } from "@/ui/Menu";
import { Badge, EmptyState, Skeleton } from "@/ui/misc";
import { SortViewControls } from "@/features/files/FilesPages";

function Gate({ token, onDone }: { token: string; onDone(): void }) {
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  return (
    <form className="mx-auto mt-24 w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await api(`/public/share/${token}/unlock`, { body: { password: pw } }); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }}>
      <div className="flex items-center gap-2.5"><span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary-ink"><KeyRound className="size-5" /></span><div><h1 className="text-[16px] font-bold">Tautan dilindungi</h1><p className="text-[13px] text-muted">Masukkan kata sandi untuk membuka.</p></div></div>
      <Field label="Kata sandi" error={err}>{(id) => <Input id={id} type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">Buka</Button>
    </form>
  );
}

function Content({ token, meta }: { token: string; meta: PublicShareDto }) {
  const qc = useQueryClient(); const editor = meta.role === "EDITOR";
  const [folderId, setFolderId] = useState("root"); const [view, setView] = usePersistentState<"grid" | "list">("sd-view", "grid");
  const [sort, setSort] = usePersistentState<SortState>("sd-sort", { key: "name", dir: "asc" }); const [filter, setFilter] = useState(emptyFilter);
  const selection = useSelection(); const menu = useMenu(); const fileInput = useRef<HTMLInputElement>(null);
  const [dlg, setDlg] = useState<null | { t: "folder" } | { t: "rename"; e: FileEntry } | { t: "delete"; e: FileEntry }>(null); const [preview, setPreview] = useState<number | null>(null);

  const q = useInfiniteQuery({
    queryKey: ["files", "share", token, folderId], initialPageParam: undefined as string | undefined, enabled: meta.isFolder,
    queryFn: ({ pageParam }) => api<FileListing>(`/public/share/${token}/list?folderId=${encodeURIComponent(folderId)}${pageParam ? `&pageToken=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (p) => p.nextPageToken ?? undefined,
  });
  useEffect(() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]); // eslint-disable-line react-hooks/exhaustive-deps
  const single = useQuery({ queryKey: ["share-item", token], queryFn: () => api<FileEntry>(`/public/share/${token}/item`), enabled: !meta.isFolder });
  const all = useMemo(() => (meta.isFolder ? q.data?.pages.flatMap((p) => p.items) ?? [] : single.data ? [single.data] : []), [q.data, single.data, meta.isFolder]);
  const shown = useMemo(() => sortEntries(applyFilter(all, filter), sort), [all, filter, sort]);
  const crumbs = q.data?.pages[0]?.folder.path ?? [];
  const previewList = useMemo(() => shown.filter((e) => previewable(e)), [shown]);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["files", "share", token] }), [qc, token]);
  const go = (id: string) => { selection.clear(); setFolderId(id); };
  const open = (e: FileEntry) => { if (e.isFolder) return go(e.id); const i = previewList.findIndex((x) => x.id === e.id); if (i >= 0) setPreview(i); else startDownload(`/api/v1/public/share/${token}/files/${e.id}/download`, e.name); };
  const upload = (files: UploadInput[]) => { if (editor && files.length) enqueueUploads(files, { storageId: "share", storageName: meta.name, parentId: folderId, folderLabel: meta.name, shareToken: token }); };
  const download = (ids: string[]) => {
    const one = ids.length === 1 ? shown.find((e) => e.id === ids[0]) : undefined;
    if (ids.length === 1) return startDownload(`/api/v1/public/share/${token}/files/${ids[0]}/download`, one?.name ?? meta.name);
    startDownload({ action: `/api/v1/public/share/${token}/zip`, fields: ids.map((id) => ["id", id] as [string, string]) }, ids[0] === "root" ? `${meta.name} (ZIP)` : `${ids.length} item (ZIP)`);
  };
  const sel = shown.filter((e) => selection.selected.has(e.id));
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.success(ok); await refresh(); } catch (e) { toast.error((e as Error).message); } };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-6">
        {editor && <><Button variant="primary" size="sm" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>Unggah</Button><Button size="sm" icon={<FolderPlus className="size-4" />} onClick={() => setDlg({ t: "folder" })}>Folder baru</Button></>}
        {sel.length > 0 ? <Button size="sm" variant="soft" icon={<Download className="size-4" />} onClick={() => download(sel.map((e) => e.id))}>Unduh {sel.length > 1 ? `${sel.length} item (ZIP)` : ""}</Button>
          : meta.isFolder && <Button size="sm" icon={<Download className="size-4" />} onClick={() => download(["root"])}>Unduh semua (ZIP)</Button>}
        <FilterButton value={filter} onChange={setFilter} /><span className="flex-1" />
        <SortViewControls sort={sort} setSort={setSort} view={view} setView={setView} />
      </div>
      <FilterChips value={filter} onChange={setFilter} />
      {meta.isFolder && <nav aria-label="Lokasi" className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-4 py-1.5 text-[13px] sm:px-6">
        <button className={cn("rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2", !crumbs.length && "font-semibold")} onClick={() => go("root")}>{meta.name}</button>
        {crumbs.map((c, i) => <span key={c.id} className="flex items-center gap-0.5"><ChevronRight className="size-3.5 text-faint" aria-hidden /><button className={cn("rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2", i === crumbs.length - 1 && "font-semibold")} onClick={() => go(c.id)}>{c.name}</button></span>)}</nav>}
      <FileBrowser entries={shown} view={view} selected={selection.selected} loading={q.isLoading || single.isLoading}
        empty={<EmptyState icon={FolderPlus} title="Folder ini kosong">{editor ? "Tarik file ke sini atau klik Unggah." : "Belum ada isi."}</EmptyState>}
        onSelect={(e, m) => selection.click(e.id, shown, m)} onSetSelection={(ids) => selection.setSelected(new Set(ids))} onOpen={open}
        onContext={(e, x, y) => e && menu.open(x, y, [
          { label: e.isFolder ? "Buka" : "Pratinjau", icon: <Eye />, onSelect: () => open(e) },
          { label: e.isFolder ? "Unduh sebagai ZIP" : "Unduh", icon: <Download />, onSelect: () => download([e.id]) },
          { label: "Ganti nama", icon: <Pencil />, hidden: !editor, divider: true, onSelect: () => setDlg({ t: "rename", e }) },
          { label: "Hapus", icon: <Trash2 />, danger: true, hidden: !editor, onSelect: () => setDlg({ t: "delete", e }) },
        ])}
        onKeyAction={(k) => { if (k === "selectAll") selection.selectAll(shown); if (k === "clear") selection.clear(); if (k === "delete" && editor && sel.length === 1) setDlg({ t: "delete", e: sel[0]! }); }}
        onDropItems={() => {}} onDropFiles={(_t, files) => upload(files)} dropLabel={`Unggah ke ${crumbs.at(-1)?.name ?? meta.name}`} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])].map((file) => ({ file }))); e.target.value = ""; }} />
      {menu.element}
      <NameDialog open={dlg?.t === "folder"} title="Folder baru" label="Nama folder" action="Buat" onClose={() => setDlg(null)} onSubmit={async (name) => { await api(`/public/share/${token}/folders`, { body: { parentId: folderId, name } }); await refresh(); }} />
      <NameDialog open={dlg?.t === "rename"} title="Ganti nama" label="Nama baru" initial={dlg?.t === "rename" ? dlg.e.name : ""} action="Simpan" onClose={() => setDlg(null)} onSubmit={async (name) => { if (dlg?.t === "rename") { await api(`/public/share/${token}/rename`, { body: { fileId: dlg.e.id, name } }); await refresh(); } }} />
      <DeleteDialog open={dlg?.t === "delete"} entries={dlg?.t === "delete" ? [dlg.e] : []} onClose={() => setDlg(null)} onConfirm={() => act(async () => { if (dlg?.t === "delete") await api(`/public/share/${token}/files/${dlg.e.id}`, { method: "DELETE" }); }, "Dipindahkan ke sampah pemilik")} />
      {preview !== null && <Preview items={previewList} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />}
      <FloatingProgress />
    </div>
  );
}

export default function PublicSharePage() {
  const { token = "" } = useParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["share-meta", token], queryFn: () => api<PublicShareDto>(`/public/share/${token}`), retry: false, staleTime: 30_000 });
  const gone = q.error instanceof ApiError && q.error.status === 404;
  return (
    <FileUrlsProvider token={token}>
      <div className="flex h-dvh flex-col bg-canvas">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <Logo />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <div className="min-w-0 flex-1">{q.data ? <><p className="truncate text-[14px] font-semibold" title={q.data.name}>{q.data.name}</p><p className="text-[12px] text-muted">{q.data.role === "EDITOR" ? "Anda bisa mengunggah dan mengubah isi folder ini" : "Dibagikan kepada Anda"}{q.data.expiresAt ? ` · berlaku sampai ${new Date(q.data.expiresAt).toLocaleDateString("id-ID")}` : ""}</p></> : <Skeleton className="h-8 w-48" />}</div>
          {q.data && <Badge tone={q.data.role === "EDITOR" ? "warn" : "primary"}>{q.data.role === "EDITOR" ? "Editor" : "Penonton"}</Badge>}
          {q.data?.maxUploadBytes ? <span className="tnum hidden text-[12px] text-muted sm:inline">Kuota {formatBytes(q.data.uploadedBytes)} / {formatBytes(q.data.maxUploadBytes)}</span> : null}
        </header>
        {gone ? <EmptyState icon={Link2Off} title="Tautan tidak berlaku">Tautan ini sudah dimatikan, kedaluwarsa, atau tidak pernah ada. Minta pemiliknya membagikan tautan baru.</EmptyState>
          : q.isError ? <EmptyState icon={Link2Off} title="Tidak dapat membuka tautan">{(q.error as Error).message}</EmptyState>
          : !q.data ? <div className="p-8"><Skeleton className="h-64" /></div>
          : q.data.requiresPassword && !q.data.unlocked ? <Gate token={token} onDone={() => void qc.invalidateQueries({ queryKey: ["share-meta", token] })} />
          : <Content token={token} meta={q.data} />}
        <Toaster position="bottom-left" />
      </div>
    </FileUrlsProvider>
  );
}
