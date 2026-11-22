import type { StorageConnectionDto } from "@superdrive/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/ui/Button";
import { Field, Input, Select } from "@/ui/Field";

type Step = "form" | "code" | "password" | "finishing";
interface Reply { loginId: string; state: "starting" | "code" | "password" | "ready" | "error"; error?: string }
export type TelegramMode = { type: "new" } | { type: "relogin"; storage: StorageConnectionDto };

/**
 * Connects a Telegram account as storage: number, then the code Telegram sends to the account, then the two-step password if it has one.
 * The same flow signs in again to an existing Telegram storage (the API ID and hash are already kept, so they are not asked).
 */
export function TelegramConnect({ mode, onDone, onBack }: { mode: TelegramMode; onDone(): void; onBack?(): void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("form"); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [v, setV] = useState({ name: "", apiId: "", apiHash: "", phone: "", chat: "channel", code: "", password: "" });
  const login = useRef(""); const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  // A sign-in left half-way is dropped on the server when this closes.
  useEffect(() => () => { if (login.current) void api(`/storages/telegram/login/${login.current}`, { method: "DELETE" }).catch(() => {}); }, []);

  const finish = async () => {
    setStep("finishing");
    try {
      if (mode.type === "new") await api("/storages", { body: { provider: "TELEGRAM", name: v.name.trim(), loginId: login.current, chat: v.chat } });
      else await api(`/storages/${mode.storage.id}/telegram/relogin`, { body: { loginId: login.current } });
      login.current = ""; toast.success(mode.type === "new" ? "Telegram terhubung" : "Masuk ulang berhasil");
      await qc.invalidateQueries({ queryKey: ["storages"] }); onDone();
    } catch (e) { setErr((e as Error).message); setStep("form"); }
  };
  const handle = async (r: Reply) => {
    login.current = r.loginId;
    if (r.state === "ready") return finish();
    if (r.state === "error") { login.current = ""; setErr(r.error ?? "Gagal masuk."); setStep("form"); return; }
    setErr(r.error ?? ""); setStep(r.state === "password" ? "password" : "code");
  };
  const run = async (fn: () => Promise<Reply>) => { setBusy(true); setErr(""); try { await handle(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const start = () => run(() => mode.type === "new"
    ? api<Reply>("/storages/telegram/login/start", { body: { apiId: Number(v.apiId), apiHash: v.apiHash.trim(), phone: v.phone } })
    : api<Reply>(`/storages/${mode.storage.id}/telegram/relogin/start`, { body: { phone: v.phone } }));
  const code = () => run(() => api<Reply>("/storages/telegram/login/code", { body: { loginId: login.current, code: v.code } }));
  const password = () => run(() => api<Reply>("/storages/telegram/login/password", { body: { loginId: login.current, password: v.password } }));
  const formOk = (mode.type === "relogin" || (v.name.trim() && v.apiId.trim() && v.apiHash.trim())) && v.phone.trim();

  return (
    <div className="space-y-4">
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{err}</p>}
      {step === "form" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (formOk) void start(); }}>
          {mode.type === "new" && <>
            <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
              Gunakan <b className="text-ink">akun Telegram khusus</b> untuk penyimpanan, bukan akun utama Anda. File disimpan di channel pribadi yang dibuat otomatis. Telegram tidak mengenkripsi file ujung ke ujung, dan unggahan besar-besaran bisa memicu pembatasan akun.
            </p>
            <Field label="Nama koneksi">{(id) => <Input id={id} required value={v.name} onChange={set("name")} placeholder="Arsip Telegram" />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="API ID">{(id) => <Input id={id} required inputMode="numeric" value={v.apiId} onChange={set("apiId")} placeholder="1234567" />}</Field>
              <Field label="API hash">{(id) => <Input id={id} required value={v.apiHash} onChange={set("apiHash")} placeholder="32 karakter" autoComplete="off" />}</Field>
            </div>
            <p className="-mt-2 text-[12px] text-muted">Dapatkan keduanya gratis di <a className="inline-flex items-center gap-0.5 text-primary-ink underline" href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org<ExternalLink className="size-3" aria-hidden /></a> → API development tools.</p>
          </>}
          {mode.type === "relogin" && <p className="text-[13px] text-muted">Masuk lagi ke akun Telegram yang sama untuk “{mode.storage.name}”. File dan channelnya tetap.</p>}
          <Field label="Nomor telepon akun Telegram" hint="Dengan kode negara, mis. +62 812 3456 7890. Telegram mengirim kode ke aplikasinya.">{(id) => <Input id={id} required type="tel" value={v.phone} onChange={set("phone")} placeholder="+62 812 3456 7890" autoComplete="off" />}</Field>
          {mode.type === "new" && <Field label="Tempat menyimpan">{(id) => <Select id={id} value={v.chat} onChange={set("chat")}><option value="channel">Channel pribadi baru (disarankan)</option><option value="saved">Pesan Tersimpan akun</option></Select>}</Field>}
          <div className="flex gap-2">{onBack && <Button type="button" onClick={onBack}>Kembali</Button>}<Button type="submit" variant="primary" loading={busy} disabled={!formOk}>Kirim kode</Button></div>
        </form>)}
      {step === "code" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (v.code.trim()) void code(); }}>
          <p className="text-[13px] text-muted">Telegram mengirim kode ke akun di nomor <b className="text-ink">{v.phone || "tadi"}</b>. Cek aplikasi Telegram Anda (percakapan “Telegram”) atau SMS.</p>
          <Field label="Kode">{(id) => <Input id={id} autoFocus inputMode="numeric" autoComplete="one-time-code" value={v.code} onChange={set("code")} placeholder="12345" />}</Field>
          <div className="flex gap-2"><Button type="button" onClick={() => { setStep("form"); setErr(""); }}>Ganti nomor</Button><Button type="submit" variant="primary" loading={busy} disabled={!v.code.trim()}>Verifikasi</Button></div>
        </form>)}
      {step === "password" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (v.password) void password(); }}>
          <p className="text-[13px] text-muted">Akun ini memakai verifikasi dua langkah. Masukkan sandi Telegram Anda (bukan kode).</p>
          <Field label="Sandi verifikasi dua langkah">{(id) => <Input id={id} autoFocus type="password" autoComplete="current-password" value={v.password} onChange={set("password")} />}</Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!v.password}>Masuk</Button>
        </form>)}
      {step === "finishing" && <p className="text-[13px] text-muted" role="status">{mode.type === "new" ? "Membuat channel dan menghubungkan…" : "Menghubungkan ulang…"}</p>}
    </div>
  );
}
