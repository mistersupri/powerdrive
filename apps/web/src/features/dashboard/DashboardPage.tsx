import type { AuditLogDto, DashboardDto } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Cable, Database, HardDrive, Plus } from "lucide-react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { transferStore } from "@/features/transfers/store";
import { useWorkspace } from "@/features/auth/useAuth";
import { PageHeader } from "@/features/layout/Shell";
import { StorageTile } from "@/features/files/FilesPages";
import { Button } from "@/ui/Button";
import { Card, EmptyState, Skeleton } from "@/ui/misc";

export const ACTION_TEXT: Record<string, (m: any) => string> = {
  "auth.login": () => "Masuk ke akun", "auth.register": () => "Mendaftar", "auth.change_password": () => "Mengubah kata sandi",
  "storage.connect": (m) => `Menghubungkan ${m?.name ?? "penyimpanan"}`, "storage.disconnect": (m) => `Memutus ${m?.name ?? "penyimpanan"}`, "storage.reconnect": () => "Menghubungkan ulang penyimpanan", "storage.update": () => "Memperbarui penyimpanan",
  "file.upload": (m) => `Mengunggah ${m?.name ?? "file"}`, "file.download": (m) => `Mengunduh ${m?.name ?? "file"}`, "file.delete": (m) => `Menghapus ${m?.name ?? "file"}`,
  "file.rename": (m) => `Mengganti nama ${m?.from ?? ""} → ${m?.to ?? ""}`, "file.create_folder": (m) => `Membuat folder ${m?.name ?? ""}`,
  "transfer.copy.create": (m) => `Menyalin ${m?.items ?? ""} item: ${m?.from ?? ""} → ${m?.to ?? ""}`, "transfer.move.create": (m) => `Memindahkan ${m?.items ?? ""} item: ${m?.from ?? ""} → ${m?.to ?? ""}`,
  "transfer.complete": (m) => `Transfer selesai: ${m?.title ?? ""}`, "transfer.fail": (m) => `Transfer gagal: ${m?.title ?? ""}`, "transfer.cancel": () => "Transfer dibatalkan",
  "member.invite": (m) => `Mengundang ${m?.email ?? ""}`, "member.role_change": (m) => `Mengubah peran ${m?.from ?? ""} → ${m?.to ?? ""}`, "member.remove": () => "Mengeluarkan anggota",
  "permission.change": () => "Mengubah hak akses penyimpanan", "mount.create": () => "Membuat mount virtual", "workspace.create": () => "Membuat workspace",
};
export const actionText = (l: AuditLogDto) => (ACTION_TEXT[l.action]?.(l.metadata) ?? l.action);

function Stat({ icon: Icon, tone, label, value, hint }: { icon: typeof Database; tone: string; label: string; value: string; hint?: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <span className={`grid size-11 shrink-0 place-items-center rounded-[10px] ${tone}`}><Icon className="size-5" aria-hidden /></span>
      <div className="min-w-0"><div className="tnum text-[24px] leading-tight font-bold">{value}</div><div className="truncate text-[13px] text-muted">{label}</div>{hint && <div className="truncate text-[11px] text-faint">{hint}</div>}</div>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useWorkspace();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardDto>("/dashboard"), staleTime: 10_000 });
  const active = transferStore.use((s) => s.jobs.filter((j) => ["QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING"].includes(j.status)).length);
  const d = q.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Beranda" subtitle={user ? `Selamat datang kembali, ${user.name.split(" ")[0]}` : undefined} />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-4 sm:p-8">
        {q.isLoading || !d ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={HardDrive} tone="bg-primary-soft text-primary-ink" label="Penyimpanan terhubung" value={String(d.storages)} />
            <Stat icon={Cable} tone="bg-ok-soft text-ok-ink" label="Penyedia" value={String(d.providers)} hint={d.storages ? `${d.storages} akun` : undefined} />
            <Stat icon={Database} tone="bg-warn-soft text-warn-ink" label="Terpakai (yang diketahui)" value={d.knownCapacity ? formatBytes(d.knownUsage) : d.knownUsage ? formatBytes(d.knownUsage) : "–"} hint={d.knownCapacity ? `dari ${formatBytes(d.knownCapacity)}` : "Penyedia tidak melaporkan kapasitas"} />
            <Stat icon={ArrowRightLeft} tone="bg-violet-soft text-violet-ink" label="Transfer aktif" value={String(active || d.transfers.active)} hint={`${d.transfers.completed} selesai · ${d.transfers.failed} gagal`} />
          </div>)}
        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-[15px] font-semibold">Penyimpanan</h2><Link to="/storage" className="text-[13px] font-medium text-primary-ink hover:underline">Kelola</Link></div>
            {!d ? <Skeleton className="h-40" /> : d.storageList.length === 0 ? <EmptyState icon={HardDrive} title="Belum ada penyimpanan" action={<Link to="/storage"><Button variant="primary" icon={<Plus className="size-4" />}>Hubungkan penyimpanan</Button></Link>}>Hubungkan akun cloud atau folder server untuk memulai.</EmptyState>
              : <div className="grid gap-3 lg:grid-cols-2">{d.storageList.map((s) => <StorageTile key={s.id} s={s} />)}</div>}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Aktivitas terbaru</h2>
            {!d ? <Skeleton className="h-40" /> : d.recentActivity.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">Belum ada aktivitas.</p> : (
              <ul className="divide-y divide-line">{d.recentActivity.map((l) => (
                <li key={l.id} className="flex items-start gap-3 py-2.5"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden /><div className="min-w-0"><p className="truncate text-[13px]" title={actionText(l)}>{actionText(l)}</p><p className="text-[11px] text-muted">{l.userName ?? "Sistem"} · {timeAgo(l.createdAt)}</p></div></li>))}</ul>)}
          </Card>
        </div>
      </div>
    </div>
  );
}
