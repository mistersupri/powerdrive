import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Card } from "@/ui/misc";

interface Status { enabled: boolean; required: boolean; recoveryLeft: number }
interface Setup { secret: string; otpauthUrl: string; qrSvg: string }

export const useMfaStatus = () => useQuery({ queryKey: ["mfa"], queryFn: () => api<Status>("/auth/mfa"), staleTime: 30_000, retry: false });

/** Turn two-step verification on or off for the signed-in account. `forced` is the full-page version shown when the administrator requires it. */
export function MfaCard({ forced = false }: { forced?: boolean }) {
  const qc = useQueryClient(); const st = useMfaStatus();
  const [setup, setSetup] = useState<Setup | null>(null); const [code, setCode] = useState(""); const [codes, setCodes] = useState<string[] | null>(null); const [pw, setPw] = useState(""); const [off, setOff] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["mfa"] }); };
  const start = useMutation({ mutationFn: () => api<Setup>("/auth/mfa/setup", { body: {} }), onSuccess: setSetup, onError: (e) => toast.error((e as Error).message) });
  const enable = useMutation({ mutationFn: () => api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { body: { code } }), onSuccess: (r) => { setCodes(r.recoveryCodes); setSetup(null); setCode(""); refresh(); }, onError: (e) => { toast.error((e as Error).message); setCode(""); } });
  const disable = useMutation({ mutationFn: () => api("/auth/mfa/disable", { body: { password: pw } }), onSuccess: () => { toast.success("Verifikasi dua langkah dimatikan"); setOff(false); setPw(""); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const text = codes?.join("\n") ?? "";
  const copy = async () => { await navigator.clipboard.writeText(text); toast.success("Kode pemulihan disalin"); };
  const save = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`Kode pemulihan. Simpan di tempat aman; tiap kode hanya berlaku sekali.\n\n${text}\n`], { type: "text/plain" })); a.download = "kode-pemulihan.txt"; a.click(); URL.revokeObjectURL(a.href); };

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${st.data?.enabled ? "bg-ok-soft text-ok-ink" : "bg-surface-2 text-muted"}`}>{st.data?.enabled ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Verifikasi dua langkah</h2>
          <p className="text-[13px] text-muted">{forced ? "Administrator mewajibkan verifikasi dua langkah untuk akun Anda. Aktifkan dulu untuk melanjutkan." : st.data?.enabled ? `Aktif. ${st.data.recoveryLeft} kode pemulihan tersisa.` : "Tambahkan lapisan keamanan: selain kata sandi, masuk butuh kode dari aplikasi autentikator (Google Authenticator, Authy, 1Password, dll)."}</p>
        </div>
      </div>

      {codes ? (
        <div className="space-y-3 rounded-xl border border-warn-ink/40 bg-warn-soft p-4" role="status">
          <p className="text-[13px] font-semibold text-warn-ink">Simpan kode pemulihan ini sekarang. Ini satu-satunya kali ditampilkan.</p>
          <ul className="tnum grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[13px]" aria-label="Kode pemulihan">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="flex flex-wrap gap-2"><Button size="sm" icon={<Copy className="size-3.5" />} onClick={copy}>Salin</Button><Button size="sm" icon={<Download className="size-3.5" />} onClick={save}>Unduh .txt</Button><Button size="sm" variant="primary" onClick={() => setCodes(null)}>Sudah saya simpan</Button></div>
        </div>
      ) : setup ? (
        <form className="grid gap-4 sm:grid-cols-[180px_1fr]" onSubmit={(e) => { e.preventDefault(); if (code.trim()) enable.mutate(); }}>
          <img alt="Kode QR untuk aplikasi autentikator" width={180} height={180} className="size-[180px] rounded-lg border border-line bg-white p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} />
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted"><li>Pindai kode QR dengan aplikasi autentikator.</li><li>Jika tidak bisa memindai, ketik kunci ini: <code className="tnum rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] break-all text-ink">{setup.secret}</code></li><li>Masukkan kode 6 digit yang muncul.</li></ol>
            <Field label="Kode 6 digit">{(id) => <Input id={id} autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className="tnum w-40 tracking-widest" placeholder="123456" />}</Field>
            <div className="flex gap-2"><Button type="submit" variant="primary" loading={enable.isPending} disabled={!code.trim()}>Aktifkan</Button><Button type="button" variant="ghost" onClick={() => setSetup(null)}>Batal</Button></div>
          </div>
        </form>
      ) : st.data?.enabled ? (
        off ? (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); disable.mutate(); }}>
            <Field label="Kata sandi untuk konfirmasi">{(id) => <Input id={id} type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <Button type="submit" variant="danger" loading={disable.isPending} disabled={!pw}>Matikan</Button><Button type="button" variant="ghost" onClick={() => setOff(false)}>Batal</Button>
          </form>
        ) : <div><Button size="sm" onClick={() => setOff(true)} disabled={st.data.required} title={st.data.required ? "Diwajibkan administrator" : undefined}>Matikan verifikasi dua langkah</Button></div>
      ) : <div><Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>Aktifkan verifikasi dua langkah</Button></div>}
    </Card>
  );
}
