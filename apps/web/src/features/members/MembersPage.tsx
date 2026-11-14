import type { AuditLogDto, MemberDto, WorkspaceRole } from "@superdrive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Search, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, getWorkspaceId } from "@/lib/api";
import { dateTime, shortDate } from "@/lib/format";
import { useWorkspace } from "@/features/auth/useAuth";
import { actionText } from "@/features/dashboard/DashboardPage";
import { PageHeader } from "@/features/layout/Shell";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input, Select } from "@/ui/Field";
import { Avatar, Badge, Card, EmptyState, Skeleton } from "@/ui/misc";

const ROLE: Record<WorkspaceRole, string> = { OWNER: "Pemilik", ADMIN: "Admin", MEMBER: "Anggota", VIEWER: "Pembaca" };
interface Invite { id: string; email: string; role: WorkspaceRole; expiresAt: string }

export function MembersPage() {
  const { isAdmin, role, user } = useWorkspace(); const qc = useQueryClient(); const ws = getWorkspaceId();
  const q = useQuery({ queryKey: ["members"], queryFn: () => api<{ members: MemberDto[]; invitations: Invite[] }>(`/workspaces/${ws}/members`) });
  const [inv, setInv] = useState(false); const [email, setEmail] = useState(""); const [r, setR] = useState<WorkspaceRole>("MEMBER"); const [link, setLink] = useState(""); const [copied, setCopied] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });
  const invite = useMutation({ mutationFn: () => api<{ link: string }>(`/workspaces/${ws}/invitations`, { body: { email, role: r } }), onSuccess: (d) => { setLink(d.link); void refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const setRole = useMutation({ mutationFn: (v: { id: string; role: WorkspaceRole }) => api(`/workspaces/${ws}/members/${v.id}`, { method: "PATCH", body: { role: v.role } }), onSuccess: () => { toast.success("Peran diubah"); void refresh(); }, onError: (e) => { toast.error((e as Error).message); void refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/workspaces/${ws}/members/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Anggota dikeluarkan"); void refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/workspaces/${ws}/invitations/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const roles: WorkspaceRole[] = role === "OWNER" ? ["OWNER", "ADMIN", "MEMBER", "VIEWER"] : ["ADMIN", "MEMBER", "VIEWER"];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Anggota" subtitle="Siapa saja yang bisa masuk ke workspace ini." actions={isAdmin ? <Button variant="primary" size="sm" icon={<UserPlus className="size-4" />} onClick={() => { setInv(true); setLink(""); setEmail(""); }}>Undang</Button> : undefined} />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-4 sm:p-8">
        <Card className="mx-auto max-w-4xl divide-y divide-line">
          {q.isLoading ? <Skeleton className="m-4 h-32" /> : q.data?.members.map((m) => (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 p-4">
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1"><p className="text-[14px] font-medium break-words sm:truncate">{m.name}{m.userId === user?.id && <span className="ml-2 text-[12px] font-normal text-muted">(Anda)</span>}</p><p className="text-[12px] break-words text-muted sm:truncate"><span className="break-all">{m.email}</span><span className="block sm:inline"><span className="hidden sm:inline"> · </span>bergabung {shortDate(m.createdAt)}</span></p></div>
              {isAdmin && m.userId !== user?.id && (role === "OWNER" || m.role !== "OWNER") ? (
                <><Select aria-label={`Peran ${m.name}`} className="h-8 w-32 text-[13px]" value={m.role} onChange={(e) => setRole.mutate({ id: m.userId, role: e.target.value as WorkspaceRole })}>{roles.map((x) => <option key={x} value={x}>{ROLE[x]}</option>)}</Select>
                  <Button size="sm" variant="ghost" aria-label={`Keluarkan ${m.name}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => { if (confirm(`Keluarkan ${m.name} dari workspace?`)) remove.mutate(m.userId); }}><Trash2 className="size-4" /></Button></>
              ) : <Badge tone={m.role === "OWNER" ? "primary" : "neutral"}>{ROLE[m.role]}</Badge>}
            </div>))}
        </Card>
        {!!q.data?.invitations.length && (
          <Card className="mx-auto max-w-4xl"><h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Undangan tertunda</h2>
            <ul className="divide-y divide-line">{q.data.invitations.map((i) => <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-[13px]"><span className="flex-1">{i.email}</span><Badge>{ROLE[i.role]}</Badge><span className="text-muted">berlaku sampai {shortDate(i.expiresAt)}</span><Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Batalkan</Button></li>)}</ul></Card>)}
      </div>
      <Dialog open={inv} onClose={() => setInv(false)} title="Undang anggota" description="Tautan undangan berlaku 7 hari dan hanya bisa dipakai oleh email ini."
        footer={link ? <Button variant="primary" onClick={() => setInv(false)}>Selesai</Button> : <><Button onClick={() => setInv(false)}>Batal</Button><Button variant="primary" loading={invite.isPending} disabled={!email} onClick={() => invite.mutate()}>Buat tautan</Button></>}>
        {link ? (<div className="space-y-3"><p className="text-[13px] text-muted">Salin tautan ini dan kirim ke {email}. Tautan hanya ditampilkan sekali.</p>
          <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Tautan undangan" /><Button icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => { void navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Tersalin" : "Salin"}</Button></div></div>
        ) : (<div className="space-y-4"><Field label="Email">{(id) => <Input id={id} type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rekan@instansi.id" />}</Field>
          <Field label="Peran" hint="Pembaca hanya bisa melihat dan mengunduh.">{(id) => <Select id={id} value={r} onChange={(e) => setR(e.target.value as WorkspaceRole)}>{roles.map((x) => <option key={x} value={x}>{ROLE[x]}</option>)}</Select>}</Field></div>)}
      </Dialog>
    </div>
  );
}

export function ActivityPage() {
  const [page, setPage] = useState(1); const [text, setText] = useState(""); const [kind, setKind] = useState("");
  const q = useQuery({ queryKey: ["audit", page, text, kind], queryFn: () => api<{ items: AuditLogDto[]; total: number }>(`/audit-logs?page=${page}&limit=40${kind ? `&action=${kind}` : ""}${text ? `&q=${encodeURIComponent(text)}` : ""}`), placeholderData: (p) => p });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 40));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Log aktivitas" subtitle="Catatan tindakan di workspace. Isi file dan kredensial tidak pernah dicatat." />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-8">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden /><Input aria-label="Cari log" className="h-8 w-60 pl-8 text-[13px]" placeholder="Cari nama file atau pengguna" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} /></div>
        <Select aria-label="Jenis aktivitas" className="h-8 w-44 text-[13px]" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">Semua aktivitas</option><option value="file.">File</option><option value="transfer.">Transfer</option><option value="storage.">Penyimpanan</option><option value="member.">Anggota</option><option value="auth.">Autentikasi</option><option value="permission.">Hak akses</option></Select>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        {q.isLoading ? <Skeleton className="h-64" /> : !q.data?.items.length ? <EmptyState icon={Search} title="Tidak ada aktivitas">Coba ubah kata kunci atau filter.</EmptyState> : (
          <Card className="mx-auto max-w-5xl overflow-hidden">
            <ul className="divide-y divide-line sm:hidden">{q.data.items.map((l) => <li key={l.id} className="px-4 py-3 text-[13px]"><p className="break-words">{actionText(l)}</p><p className="tnum mt-0.5 text-[12px] text-muted">{l.userName ?? "Sistem"} · {dateTime(l.createdAt)}{l.ipAddress ? ` · ${l.ipAddress}` : ""}</p></li>)}</ul>
            <table className="hidden w-full text-left text-[13px] sm:table"><thead><tr className="border-b border-line bg-surface-2/60 text-[12px] text-muted"><th className="px-4 py-2.5 font-semibold">Waktu</th><th className="px-4 py-2.5 font-semibold">Pengguna</th><th className="px-4 py-2.5 font-semibold">Aktivitas</th><th className="hidden px-4 py-2.5 font-semibold md:table-cell">Alamat IP</th></tr></thead>
              <tbody className="divide-y divide-line">{q.data.items.map((l) => <tr key={l.id}><td className="tnum px-4 py-2.5 whitespace-nowrap text-muted">{dateTime(l.createdAt)}</td><td className="px-4 py-2.5">{l.userName ?? "Sistem"}</td><td className="max-w-md truncate px-4 py-2.5" title={actionText(l)}>{actionText(l)}</td><td className="tnum hidden px-4 py-2.5 text-muted md:table-cell">{l.ipAddress ?? "—"}</td></tr>)}</tbody></table>
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-muted"><span className="tnum">{q.data.total} catatan</span><div className="flex items-center gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button><span className="tnum">{page} / {pages}</span><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</Button></div></div>
          </Card>)}
      </div>
    </div>
  );
}
