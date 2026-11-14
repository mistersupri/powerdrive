import type { Paged, ShareLinkDto } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Link2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Badge, Card, EmptyState, Skeleton } from "@/ui/misc";

export default function SharesPage() {
  const qc = useQueryClient(); const [page, setPage] = useState(1); const [copied, setCopied] = useState("");
  const q = useQuery({ queryKey: ["shares-all", page], queryFn: () => api<Paged<ShareLinkDto>>(`/shares/all?page=${page}&limit=25`), placeholderData: (p) => p });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/shares/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Tautan dimatikan"); void qc.invalidateQueries({ queryKey: ["shares-all"] }); } });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 25));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Tautan berbagi" subtitle="Semua tautan publik yang sedang aktif. Matikan kapan saja." />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {q.isLoading ? <Skeleton className="h-64" /> : !q.data?.items.length ? <EmptyState icon={Link2} title="Belum ada tautan berbagi">Klik kanan file atau folder lalu pilih “Bagikan” untuk membuat tautan penonton atau editor.</EmptyState> : (
          <Card className="mx-auto max-w-5xl overflow-hidden"><ul className="divide-y divide-line">
            {q.data.items.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`grid size-9 place-items-center rounded-lg ${l.role === "EDITOR" ? "bg-warn-soft text-warn-ink" : "bg-primary-soft text-primary-ink"}`}>{l.role === "EDITOR" ? <Pencil className="size-4" /> : <Eye className="size-4" />}</span>
                <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-0"><p className="text-[14px] font-medium break-words sm:truncate" title={l.name}>{l.name}</p>
                  <p className="tnum text-[12px] text-muted sm:truncate">{l.storageName} · {l.createdByName ?? "—"} · {l.accessCount}× dibuka · {l.expiresAt ? `sampai ${dateTime(l.expiresAt)}` : "tanpa batas"}</p></div>
                <Badge tone={l.role === "EDITOR" ? "warn" : "primary"}>{l.role === "EDITOR" ? "Editor" : "Penonton"}</Badge>{l.hasPassword && <Badge>Sandi</Badge>}{l.expired && <Badge tone="danger">Kedaluwarsa</Badge>}
                <Button size="sm" icon={copied === l.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={async () => { await navigator.clipboard.writeText(l.url); setCopied(l.id); setTimeout(() => setCopied(""), 1500); }}>Salin</Button>
                <Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft" aria-label={`Matikan tautan ${l.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => revoke.mutate(l.id)}><span className="hidden sm:inline">Matikan</span></Button>
              </li>))}</ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-muted"><span className="tnum">{q.data.total} tautan</span><div className="flex items-center gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button><span className="tnum">{page} / {pages}</span><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</Button></div></div>
          </Card>)}
      </div>
    </div>
  );
}
