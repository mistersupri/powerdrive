import { Pagination } from "@/ui/Pagination";
import type { Paged, ShareLinkDto } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Link2, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Input, Select } from "@/ui/Field";
import { Badge, Card, EmptyState, Skeleton } from "@/ui/misc";
import { useDebounced } from "@/lib/useDebounced";

export default function SharesPage() {
  const qc = useQueryClient(); const [page, setPage] = useState(1); const [copied, setCopied] = useState("");
  const [text, setText] = useState(""); const term = useDebounced(text, 300);
  const q = useQuery({ queryKey: ["shares-all", page, term], queryFn: () => api<Paged<ShareLinkDto>>(`/shares/all?page=${page}&limit=25${term ? `&q=${encodeURIComponent(term)}` : ""}`), placeholderData: (p) => p });
  const setRole = useMutation({ mutationFn: (v: { id: string; role: "VIEWER" | "EDITOR" }) => api(`/shares/${v.id}`, { method: "PATCH", body: { role: v.role } }), onSuccess: () => { toast.success("Izin diubah, langsung berlaku"); void qc.invalidateQueries({ queryKey: ["shares-all"] }); }, onError: (e) => toast.error((e as Error).message) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/shares/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Tautan dimatikan"); void qc.invalidateQueries({ queryKey: ["shares-all"] }); } });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 25));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Tautan berbagi" subtitle="Semua tautan publik yang sedang aktif. Ubah izinnya atau matikan kapan saja." />
      <div className="border-b border-line bg-surface px-4 py-2.5 sm:px-8"><div className="relative max-w-sm"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Cari tautan" className="h-9 pl-8 text-[13px]" placeholder="Cari judul atau nama file" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} /></div></div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {q.isLoading ? <Skeleton className="h-64" /> : !q.data?.items.length ? <EmptyState icon={Link2} title={term ? "Tidak ada yang cocok" : "Belum ada tautan berbagi"}>{term ? "Coba kata kunci lain." : "Klik kanan file atau folder lalu pilih “Bagikan” untuk membuat tautan penonton atau editor."}</EmptyState> : (
          <Card className="mx-auto max-w-5xl overflow-hidden"><ul className="divide-y divide-line">
            {q.data.items.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`grid size-9 place-items-center rounded-lg ${l.role === "EDITOR" ? "bg-warn-soft text-warn-ink" : "bg-primary-soft text-primary-ink"}`}>{l.role === "EDITOR" ? <Pencil className="size-4" /> : <Eye className="size-4" />}</span>
                <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-0"><p className="text-[14px] font-medium break-words sm:truncate" title={l.title ?? l.name}>{l.title ?? l.name}</p>
                  <p className="tnum text-[12px] text-muted sm:truncate">{l.title ? `${l.name} · ` : ""}{l.storageName} · {l.createdByName ?? "–"} · {l.accessCount}× dibuka · {l.expiresAt ? `sampai ${dateTime(l.expiresAt)}` : "tanpa batas"}</p></div>
                <Select aria-label={`Izin tautan ${l.title ?? l.name}`} value={l.role} onChange={(e) => setRole.mutate({ id: l.id, role: e.target.value as "VIEWER" | "EDITOR" })} className="h-9 w-[130px] pr-6 pl-2 text-[13px]"><option value="VIEWER">Penonton</option><option value="EDITOR" disabled={!l.isFolder}>{l.isFolder ? "Editor" : "Editor (folder)"}</option></Select>{l.hasPassword && <Badge>Sandi</Badge>}{l.expired && <Badge tone="danger">Kedaluwarsa</Badge>}
                <Button size="sm" icon={copied === l.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={async () => { await navigator.clipboard.writeText(l.url); setCopied(l.id); setTimeout(() => setCopied(""), 1500); }}>Salin</Button>
                <Button size="sm" variant="ghost" className="text-danger-ink hover:bg-danger-soft" aria-label={`Matikan tautan ${l.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => revoke.mutate(l.id)}><span className="hidden sm:inline">Matikan</span></Button>
              </li>))}</ul>
            <Pagination className="border-t border-line px-4 py-2.5" page={page} pages={pages} total={q.data.total} noun="tautan" onPage={setPage} />
          </Card>)}
      </div>
    </div>
  );
}
