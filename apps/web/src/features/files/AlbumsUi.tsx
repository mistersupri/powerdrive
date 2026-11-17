import type { FileEntry } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, FolderOpen, Lock, LockOpen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAlbumVault } from "@/lib/albumVault";
import { useMe } from "@/features/auth/useAuth";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input } from "@/ui/Field";
import { EmptyState, Skeleton } from "@/ui/misc";
import { FileThumb } from "./FileThumb";

export interface Album { id: string; name: string; isPrivate: boolean; count: number; updatedAt: string; cover: FileEntry | null }
export interface PrivateStatus { hasPassword: boolean; unlocked: boolean; until: string | null; count: number }
export interface MediaFolder { storageId: string; folderId: string; name: string; storageName: string; count: number; cover: FileEntry | null }

/** Albums of the signed-in person. Private ones only appear while unlocked; the unlock lasts ten minutes, so the list refreshes now and then. */
export function useAlbums() {
  return useQuery({ queryKey: ["albums"], queryFn: () => api<{ albums: Album[]; private: PrivateStatus }>("/albums"), staleTime: 15_000, refetchInterval: 60_000 });
}
export const errCode = (e: unknown) => (e instanceof ApiError ? e.code : "");

const count = (n: number, one: string) => `${n.toLocaleString("id-ID")} ${one}`;

function Card({ cover, title, sub, onClick, badge, tone }: { cover: FileEntry | null; title: string; sub: string; onClick(): void; badge?: React.ReactNode; tone?: string }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-col gap-1.5 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <span className={cn("relative block aspect-square w-full overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line transition-shadow group-hover:shadow-card", tone)}>
        {cover ? <FileThumb file={cover} size={256} className="size-full" /> : <span className="grid size-full place-items-center text-faint"><FolderOpen className="size-8" aria-hidden /></span>}
        {badge && <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-black/60 text-white">{badge}</span>}
      </span>
      <span className="min-w-0 px-0.5"><span className="block truncate text-[13px] font-medium">{title}</span><span className="block truncate text-[12px] text-muted">{sub}</span></span>
    </button>
  );
}
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-2 gap-x-3 gap-y-4 pt-4 pb-24 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{children}</div>;

/** The "Folder" view: every folder that holds photos or videos. */
export function FolderGrid({ storageId, onOpen }: { storageId: string; onOpen(f: MediaFolder): void }) {
  const q = useQuery({ queryKey: ["media-folders", storageId], queryFn: () => api<{ items: MediaFolder[] }>(`/media/folders${storageId ? `?storageId=${storageId}` : ""}`), staleTime: 30_000 });
  if (q.isLoading) return <Grid>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</Grid>;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState icon={FolderOpen} title="Belum ada folder berisi foto">Folder yang berisi foto atau video muncul di sini.</EmptyState>;
  return <Grid>{items.map((f) => <Card key={`${f.storageId}:${f.folderId}`} cover={f.cover} title={f.name} sub={`${count(f.count, "item")}${f.storageName && f.storageName !== f.name ? ` · ${f.storageName}` : ""}`} onClick={() => onOpen(f)} />)}</Grid>;
}

/** The "Album" view: personal albums, plus the lock tile that leads to private albums. */
export function AlbumGrid({ onOpen }: { onOpen(a: Album): void }) {
  const q = useAlbums(); const qc = useQueryClient();
  const [pin, setPin] = useState<null | "unlock" | "create">(null); const [newAlbum, setNewAlbum] = useState<null | { private: boolean }>(null);
  const lock = useMutation({ mutationFn: () => api("/albums-private/lock", { body: {} }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["albums"] }) });
  if (q.isLoading) return <Grid>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</Grid>;
  const albums = q.data?.albums ?? []; const st = q.data?.private;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 pt-3">
        <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewAlbum({ private: false })}>Album baru</Button>
        {st?.unlocked && <Button size="sm" icon={<Lock className="size-4" />} onClick={() => setNewAlbum({ private: true })}>Album privat baru</Button>}
        <span className="flex-1" />
        {st?.unlocked && <Button size="sm" variant="ghost" icon={<Lock className="size-4" />} onClick={() => lock.mutate()}>Kunci album privat</Button>}
      </div>
      <Grid>
        {albums.map((a) => <Card key={a.id} cover={a.cover} title={a.name} sub={count(a.count, "item")} onClick={() => onOpen(a)} badge={a.isPrivate ? <Lock className="size-3.5" aria-label="Privat" /> : undefined} />)}
        {st && !st.unlocked && (
          <button type="button" onClick={() => setPin(st.hasPassword ? "unlock" : "create")} className="group flex min-w-0 flex-col gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <span className="grid aspect-square w-full place-items-center rounded-xl bg-navy text-white ring-1 ring-line"><Lock className="size-9" aria-hidden /></span>
            <span className="px-0.5"><span className="block text-[13px] font-medium">Album privat</span><span className="block text-[12px] text-muted">{st.hasPassword ? (st.count ? `${count(st.count, "album")} · terkunci` : "Terkunci dengan kata sandi") : "Buat kata sandi untuk memulai"}</span></span>
          </button>)}
      </Grid>
      {!albums.length && st?.unlocked && <p className="py-4 text-[13px] text-muted">Belum ada album. Buat album pertama Anda.</p>}
      <PinDialog mode={pin} onClose={() => setPin(null)} />
      <NewAlbumDialog state={newAlbum} onClose={() => setNewAlbum(null)} onCreated={onOpen} />
    </div>
  );
}

/**
 * Unlock with the album password, or create it the first time. In the Android app the fingerprint can do the typing:
 * it is offered as soon as the dialog opens once it has been set up, and offered as a checkbox after the first successful password.
 */
export function PinDialog({ mode, onClose, onDone }: { mode: null | "unlock" | "create"; onClose(): void; onDone?(): void }) {
  const qc = useQueryClient(); const me = useMe().data?.user.id; const vault = useAlbumVault(me);
  const [pw, setPw] = useState(""); const [again, setAgain] = useState(""); const [error, setError] = useState(""); const [useFinger, setUseFinger] = useState(true);
  const v = mode ? vault.state() : { available: false, enrolled: false };
  const reset = () => { setPw(""); setAgain(""); setError(""); };
  const done = async () => { reset(); await qc.invalidateQueries({ queryKey: ["albums"] }); onClose(); onDone?.(); };
  const unlockWith = async (password: string) => { await api("/albums-private/unlock", { body: { password } }); };
  const go = useMutation({
    mutationFn: async () => {
      if (mode === "create") { if (pw !== again) throw new Error("Kedua kata sandi tidak sama."); await api("/albums-private/password", { body: { password: pw } }); }
      await unlockWith(pw);
      if (v.available && !v.enrolled && useFinger) await vault.enroll(pw);
    },
    onSuccess: done, onError: (e) => { setError((e as Error).message); setPw(""); setAgain(""); },
  });
  const finger = useMutation({
    mutationFn: async () => { const saved = await vault.unlock(); if (saved === null) throw new Error("cancel"); try { await unlockWith(saved); } catch (e) { if (e instanceof ApiError && e.code === "WRONG_PASSWORD") { await vault.clear(); throw new Error("Kata sandi album sudah berubah. Masukkan kata sandi yang baru."); } throw e; } },
    onSuccess: done, onError: (e) => { if ((e as Error).message !== "cancel") setError((e as Error).message); },
  });
  // Fingerprint first, as soon as the dialog opens.
  useEffect(() => { if (mode === "unlock" && v.enrolled && !finger.isPending) finger.mutate(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = mode === "create"; const ok = pw.length >= 6 && (!create || again.length > 0);
  return (
    <Dialog open={mode !== null} onClose={() => { reset(); onClose(); }} width="max-w-sm" title={create ? "Buat kata sandi album privat" : "Buka album privat"}
      description={create ? "Kata sandi ini khusus untuk album privat (terpisah dari kata sandi masuk). Foto di album privat disembunyikan dari galeri, pencarian, dan daftar folder Anda." : "Masukkan kata sandi album Anda. Kunci terbuka selama 10 menit."}
      footer={<><Button onClick={() => { reset(); onClose(); }}>Batal</Button><Button variant="primary" loading={go.isPending} disabled={!ok} onClick={() => go.mutate()}>{create ? "Simpan dan buka" : "Buka"}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ok) go.mutate(); }}>
        {mode === "unlock" && v.enrolled && <Button type="button" className="w-full" icon={<Fingerprint className="size-4" />} loading={finger.isPending} onClick={() => finger.mutate()}>Buka dengan sidik jari</Button>}
        <Field label="Kata sandi album" hint={create ? "Minimal 6 karakter." : undefined}>{(id) => <Input id={id} type="password" autoComplete="off" autoFocus={!v.enrolled} minLength={create ? 6 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        {create && <Field label="Ulangi kata sandi">{(id) => <Input id={id} type="password" autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} />}</Field>}
        {v.available && !v.enrolled && <label className="flex min-h-10 cursor-pointer items-center gap-3 text-[13px]"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={useFinger} onChange={(e) => setUseFinger(e.target.checked)} />Buka dengan sidik jari di HP ini berikutnya</label>}
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{error}</p>}
        <button type="submit" className="sr-only">Lanjut</button>
      </form>
    </Dialog>
  );
}

function NewAlbumDialog({ state, onClose, onCreated }: { state: null | { private: boolean }; onClose(): void; onCreated(a: Album): void }) {
  const qc = useQueryClient(); const [name, setName] = useState("");
  const make = useMutation({
    mutationFn: () => api<Album>("/albums", { body: { name, private: state?.private } }),
    onSuccess: async (a) => { setName(""); await qc.invalidateQueries({ queryKey: ["albums"] }); onClose(); onCreated(a); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={state !== null} onClose={onClose} width="max-w-sm" title={state?.private ? "Album privat baru" : "Album baru"} footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={make.isPending} disabled={!name.trim()} onClick={() => make.mutate()}>Buat</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) make.mutate(); }}><Field label="Nama album">{(id) => <Input id={id} autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Liburan 2026" />}</Field></form>
    </Dialog>
  );
}

/** Pick an album (or make one) for the chosen photos. Private albums are offered once unlocked. */
export function AddToAlbumDialog({ open, items, onClose, onDone }: { open: boolean; items: FileEntry[]; onClose(): void; onDone(): void }) {
  const q = useAlbums(); const qc = useQueryClient(); const [pin, setPin] = useState(false); const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: async (albumId: string) => api<{ added: number }>(`/albums/${albumId}/items`, { body: { items: items.map((e) => ({ storageId: e.storageId, fileId: e.id })) } }),
    onSuccess: async (r) => { toast.success(r.added ? `${r.added} item ditambahkan ke album` : "Sudah ada di album itu"); await qc.invalidateQueries({ queryKey: ["albums"] }); await qc.invalidateQueries({ queryKey: ["media"] }); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const make = useMutation({ mutationFn: () => api<Album>("/albums", { body: { name } }), onSuccess: (a) => { setName(""); add.mutate(a.id); }, onError: (e) => toast.error((e as Error).message) });
  const st = q.data?.private;
  return (
    <>
      <Dialog open={open} onClose={onClose} title={`Tambah ${items.length} item ke album`} width="max-w-sm" footer={<Button onClick={onClose}>Tutup</Button>}>
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) make.mutate(); }}>
          <Input aria-label="Nama album baru" placeholder="Album baru…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" />
          <Button type="submit" variant="primary" loading={make.isPending} disabled={!name.trim()} icon={<Plus className="size-4" />}>Buat</Button>
        </form>
        <ul className="scroll-thin max-h-72 space-y-1 overflow-y-auto">
          {(q.data?.albums ?? []).map((a) => (
            <li key={a.id}><button type="button" disabled={add.isPending} onClick={() => add.mutate(a.id)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-2">
              <span className="size-9 shrink-0 overflow-hidden rounded-md bg-surface-2">{a.cover && <FileThumb file={a.cover} size={128} className="size-full" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{a.name}</span><span className="block text-[12px] text-muted">{count(a.count, "item")}</span></span>
              {a.isPrivate && <Lock className="size-4 text-muted" aria-label="Privat" />}</button></li>))}
        </ul>
        {st && !st.unlocked && <button type="button" onClick={() => setPin(true)} className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 text-[13px] text-muted hover:bg-surface-2"><LockOpen className="size-4" aria-hidden />Buka album privat…</button>}
      </Dialog>
      <PinDialog mode={pin ? (st?.hasPassword ? "unlock" : "create") : null} onClose={() => setPin(false)} />
    </>
  );
}
