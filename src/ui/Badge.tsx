import React from "react";
import { AlertCircle, CheckCircle2, Cloud, Eye, Loader2, Pencil } from "lucide-react";
import { SyncStatus, FolderPermission } from "../types/frontend.ts";
import { cn } from "../lib/cn.ts";

type Tone = "neutral" | "ok" | "warn" | "danger" | "solid";

const tones: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  ok: "bg-ok-50 text-ok-700",
  warn: "bg-warn-50 text-warn-700",
  danger: "bg-danger-50 text-danger-700",
  solid: "bg-accent-600 text-accent-fg",
};

/** Small rectangular label. Only used for real states (sync, permission, version). */
export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[11px] font-semibold leading-none whitespace-nowrap shrink-0",
        tones[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function isSyncPending(status?: SyncStatus) {
  return status === SyncStatus.PENDING || status === SyncStatus.PROCESSING || status === SyncStatus.RETRYING;
}

/** Sync state of a file that lives in a Google-Drive-synced folder. */
export function SyncBadge({ status, long = false, error }: { status: SyncStatus; long?: boolean; error?: string | null }) {
  if (status === SyncStatus.SYNCED) {
    return (
      <Badge tone="ok" icon={<CheckCircle2 className="w-3 h-3" />}>
        {long ? "Tersinkron di Drive" : "Tersinkron"}
      </Badge>
    );
  }
  if (isSyncPending(status)) {
    return (
      <Badge tone="neutral" icon={<Loader2 className="w-3 h-3 animate-spin" />}>
        {status === SyncStatus.RETRYING ? "Mencoba ulang" : long ? "Dalam antrean" : "Antrean"}
      </Badge>
    );
  }
  if (status === SyncStatus.FAILED) {
    return (
      <Badge tone="danger" icon={<AlertCircle className="w-3 h-3" />} title={error || undefined}>
        {long ? "Gagal sinkron" : "Gagal"}
      </Badge>
    );
  }
  return null;
}

export function DriveLinkedBadge() {
  return (
    <Badge tone="neutral" icon={<Cloud className="w-3 h-3" />} title="Folder ini tersinkron ke Google Drive">
      Google Drive
    </Badge>
  );
}

export function PermissionBadge({ permission }: { permission?: FolderPermission }) {
  return permission === FolderPermission.VIEW ? (
    <Badge tone="warn" icon={<Eye className="w-3 h-3" />}>
      Hanya lihat
    </Badge>
  ) : (
    <Badge tone="ok" icon={<Pencil className="w-3 h-3" />}>
      Bisa edit
    </Badge>
  );
}
