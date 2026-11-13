import type { ConnectionStatus, TransferStatus } from "@superdrive/shared";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, PauseCircle, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton rounded-md", className)} aria-hidden />;

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn("size-4 animate-spin text-muted", className)} aria-label="Memuat" />; }

export function Progress({ value, tone = "primary", className }: { value: number; tone?: "primary" | "ok" | "danger" | "warn"; className?: string }) {
  const bar = { primary: "bg-primary", ok: "bg-ok-ink", danger: "bg-danger", warn: "bg-warn-ink" }[tone];
  return (
    <div role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className={cn("h-1.5 overflow-hidden rounded-full bg-line", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", bar)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-primary text-[14px] font-semibold text-white", className)}>{name.trim()[0]?.toUpperCase() ?? "?"}</span>;
}

type Tone = "neutral" | "primary" | "ok" | "warn" | "danger";
const TONE: Record<Tone, string> = { neutral: "bg-surface-2 text-muted", primary: "bg-primary-soft text-primary-ink", ok: "bg-ok-soft text-ok-ink", warn: "bg-warn-soft text-warn-ink", danger: "bg-danger-soft text-danger-ink" };
export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium", TONE[tone])}>{Icon && <Icon className="size-3" aria-hidden />}{children}</span>;
}

// Status always pairs an icon and a word with its color.
const T_STATUS: Record<TransferStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  QUEUED: { label: "Antre", tone: "warn", icon: CircleDashed }, VALIDATING: { label: "Memeriksa", tone: "primary", icon: Loader2 },
  RUNNING: { label: "Berjalan", tone: "primary", icon: Loader2 }, PAUSED: { label: "Dijeda", tone: "neutral", icon: PauseCircle },
  RETRYING: { label: "Mencoba lagi", tone: "warn", icon: Loader2 }, VERIFYING: { label: "Memverifikasi", tone: "primary", icon: Loader2 },
  COMPLETED: { label: "Selesai", tone: "ok", icon: CheckCircle2 }, COPY_COMPLETED_SOURCE_RETAINED: { label: "Tersalin, sumber dipertahankan", tone: "warn", icon: AlertTriangle },
  FAILED: { label: "Gagal", tone: "danger", icon: XCircle }, CANCELLED: { label: "Dibatalkan", tone: "neutral", icon: XCircle },
};
export const transferStatusInfo = (s: TransferStatus | "SKIPPED") => s === "SKIPPED" ? { label: "Dilewati", tone: "neutral" as Tone, icon: CircleDashed } : T_STATUS[s];
export function TransferStatusBadge({ status }: { status: TransferStatus | "SKIPPED" }) {
  const i = transferStatusInfo(status);
  const spin = ["VALIDATING", "RUNNING", "RETRYING", "VERIFYING"].includes(status);
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium", TONE[i.tone])}><i.icon className={cn("size-3", spin && "animate-spin")} aria-hidden />{i.label}</span>;
}

const C_STATUS: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  CONNECTED: { label: "Terhubung", tone: "ok" }, DISCONNECTED: { label: "Terputus", tone: "neutral" }, TOKEN_EXPIRED: { label: "Token kedaluwarsa", tone: "warn" },
  REAUTH_REQUIRED: { label: "Perlu hubungkan ulang", tone: "warn" }, ERROR: { label: "Bermasalah", tone: "danger" }, DISABLED: { label: "Nonaktif", tone: "neutral" },
};
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const s = C_STATUS[status];
  return <Badge tone={s.tone} icon={status === "CONNECTED" ? CheckCircle2 : status === "ERROR" || status.includes("AUTH") || status === "TOKEN_EXPIRED" ? AlertTriangle : CircleDashed}>{s.label}</Badge>;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-ink"><Icon className="size-6" aria-hidden /></span>
      <h3 className="mt-2 text-[15px] font-semibold">{title}</h3>
      {children && <p className="text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)}>{children}</section>;
}
