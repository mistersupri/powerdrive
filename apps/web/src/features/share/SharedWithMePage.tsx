import type { PublicShareDto, ShareLinkDto } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, File as FileIcon, Folder, Layers, Link2Off, Pencil, Users } from "lucide-react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { PageHeader } from "@/features/layout/Shell";
import { FileUrlsProvider } from "@/features/files/urls";
import { Badge, Card, EmptyState, Skeleton } from "@/ui/misc";
import { Content } from "./PublicSharePage";

export const useSharedWithMe = () => useQuery({ queryKey: ["shared-with-me"], queryFn: () => api<ShareLinkDto[]>("/shared-with-me"), staleTime: 15_000 });

/** Everything other members shared directly with the signed-in user. */
export default function SharedWithMePage() {
  const q = useSharedWithMe();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Dibagikan ke saya" subtitle="File dan folder yang dibagikan anggota lain langsung kepada Anda." />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {q.isLoading ? <Skeleton className="h-48" /> : q.error ? <EmptyState icon={Users} title="Tidak dapat memuat">{(q.error as Error).message}</EmptyState>
          : !q.data?.length ? <EmptyState icon={Users} title="Belum ada yang dibagikan ke Anda">Saat anggota workspace membagikan file atau folder kepada Anda, itu muncul di sini.</EmptyState> : (
            <Card className="mx-auto max-w-4xl overflow-hidden">
              <ul className="divide-y divide-line">{q.data.map((s) => {
                const Icon = s.kind === "bundle" ? Layers : s.isFolder ? Folder : FileIcon; const names = s.items.map((i) => i.name).join(", ");
                return (
                  <li key={s.id}>
                    <Link to={`/shared/${s.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink"><Icon className="size-5" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium" title={s.title ?? s.name}>{s.title ?? s.name}</span>
                        <span className="block truncate text-[12px] text-muted" title={names}>{s.kind === "bundle" ? `${s.itemCount} item: ${names}${s.itemCount > s.items.length ? ", …" : ""}` : s.name}</span>
                        <span className="block truncate text-[12px] text-muted" title={dateTime(s.createdAt)}>Dari {s.createdByName ?? "anggota"} · {timeAgo(s.createdAt)} · {s.storageName}{s.expiresAt ? ` · sampai ${dateTime(s.expiresAt)}` : ""}</span>
                      </span>
                      <Badge tone={s.role === "EDITOR" ? "warn" : "primary"}>{s.role === "EDITOR" ? "Bisa mengedit" : "Hanya melihat"}</Badge>
                    </Link>
                  </li>);
              })}</ul>
            </Card>)}
      </div>
    </div>
  );
}

/** One item shared with me, opened with the same viewer as a public link, but inside the app and tied to my login. */
export function DirectSharePage() {
  const { id = "" } = useParams(); const base = `/shared/share/${id}`; const list = useSharedWithMe(); const mine = list.data?.find((s) => s.id === id);
  const q = useQuery({ queryKey: ["direct-meta", id], queryFn: () => api<PublicShareDto>(base), retry: false, staleTime: 30_000 });
  const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
  return (
    <FileUrlsProvider root={base}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title={mine?.title ?? q.data?.name ?? "Dibagikan ke saya"} subtitle={mine ? `Dari ${mine.createdByName ?? "anggota"} · ${q.data?.role === "EDITOR" ? "Anda bisa mengedit isinya" : "Hanya melihat"}` : undefined}
          actions={<Link to="/shared" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:h-11"><ArrowLeft className="size-4" aria-hidden />Semua yang dibagikan</Link>} />
        {gone ? <EmptyState icon={Link2Off} title="Item ini tidak lagi dibagikan ke Anda">Pemiliknya mungkin menghentikan berbagi atau masa berlakunya habis.</EmptyState>
          : q.isError ? <EmptyState icon={Link2Off} title="Tidak dapat membuka">{(q.error as Error).message}</EmptyState>
          : !q.data ? <div className="p-8"><Skeleton className="h-64" /></div>
          : <Content token={id} base={base} meta={q.data} />}
      </div>
    </FileUrlsProvider>
  );
}
void Eye; void Pencil;
