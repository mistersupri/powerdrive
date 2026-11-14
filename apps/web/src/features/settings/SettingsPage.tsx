import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, getWorkspaceId } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/features/auth/useAuth";
import { PageHeader } from "@/features/layout/Shell";
import { setTheme, useTheme } from "@/features/layout/theme";
import { Button } from "@/ui/Button";
import { Field, Input } from "@/ui/Field";
import { Card } from "@/ui/misc";
import { MfaCard } from "./Mfa";

export default function SettingsPage() {
  const { user, workspace, isAdmin } = useWorkspace(); const { theme } = useTheme(); const qc = useQueryClient();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [busy, setBusy] = useState(false);
  const [wsName, setWsName] = useState(workspace?.name ?? "");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Pengaturan" subtitle="Akun, tampilan, dan workspace." />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <Card className="space-y-4 p-6"><h2 className="text-[15px] font-semibold">Profil</h2>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Nama">{(id) => <Input id={id} readOnly value={user?.name ?? ""} />}</Field><Field label="Email">{(id) => <Input id={id} readOnly value={user?.email ?? ""} />}</Field></div></Card>
          <Card className="p-6"><h2 className="mb-3 text-[15px] font-semibold">Tampilan</h2>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema">
              {([["light", Sun, "Terang"], ["dark", Moon, "Gelap"]] as const).map(([v, I, l]) => (<button key={v} role="radio" aria-checked={theme === v} onClick={() => setTheme(v)} className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-[13px] font-medium transition-colors", theme === v ? "border-primary bg-primary-soft text-primary-ink" : "border-line hover:bg-surface-2")}><I className="size-5" aria-hidden />{l}</button>))}
              <button role="radio" aria-checked="false" onClick={() => { try { localStorage.removeItem("sd-theme"); } catch { /* ignore */ } setTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); try { localStorage.removeItem("sd-theme"); } catch { /* ignore */ } }} className="flex flex-col items-center gap-2 rounded-xl border border-line p-4 text-[13px] font-medium hover:bg-surface-2"><Monitor className="size-5" aria-hidden />Ikuti sistem</button>
            </div></Card>
          <MfaCard />
          <Card className="p-6"><h2 className="mb-3 text-[15px] font-semibold">Ubah kata sandi</h2>
            <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api("/auth/change-password", { body: { currentPassword: cur, newPassword: next } }); toast.success("Kata sandi diubah. Sesi di perangkat lain dikeluarkan."); setCur(""); setNext(""); } catch (er) { toast.error((er as Error).message); } finally { setBusy(false); } }}>
              <Field label="Kata sandi saat ini">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
              <Field label="Kata sandi baru" hint="Minimal 8 karakter.">{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
              <Button type="submit" variant="primary" loading={busy}>Simpan kata sandi</Button></form></Card>
          {isAdmin && <Card className="p-6"><h2 className="mb-3 text-[15px] font-semibold">Workspace</h2>
            <form className="flex items-end gap-3" onSubmit={async (e) => { e.preventDefault(); try { await api(`/workspaces/${getWorkspaceId()}`, { method: "PATCH", body: { name: wsName } }); toast.success("Nama workspace diperbarui"); await qc.invalidateQueries({ queryKey: ["me"] }); } catch (er) { toast.error((er as Error).message); } }}>
              <div className="flex-1"><Field label="Nama workspace">{(id) => <Input id={id} value={wsName} onChange={(e) => setWsName(e.target.value)} />}</Field></div><Button type="submit">Simpan</Button></form></Card>}
        </div>
      </div>
    </div>
  );
}
