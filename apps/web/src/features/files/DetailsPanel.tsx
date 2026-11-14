import type { FileEntry, FolderStats } from "@superdrive/shared";
import { formatBytes } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { KIND_ICON, KIND_TONE, kindOf } from "@/lib/fileType";
import { cn } from "@/lib/cn";
import { IconButton } from "@/ui/Button";
import { FileThumb } from "./FileThumb";

const KIND_LABEL: Record<string, string> = { folder: "Folder", image: "Gambar", video: "Video", audio: "Audio", pdf: "Dokumen PDF", text: "Teks", sheet: "Lembar kerja", slides: "Presentasi", doc: "Dokumen", archive: "Arsip", code: "Kode", other: "File" };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 py-1.5 text-[13px]"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}

/** Metadata for one file or folder. Folders also show a recursive size/count (bounded server-side). */
export function DetailsPanel({ entry, storageName, location, onClose, className, stats = true }: { entry: FileEntry; storageName?: string; location?: string; onClose?(): void; className?: string; stats?: boolean }) {
  const kind = kindOf(entry); const Icon = KIND_ICON[kind];
  const st = useQuery({ queryKey: ["files", entry.storageId, "stats", entry.id], enabled: stats && entry.isFolder, staleTime: 30_000, queryFn: () => api<FolderStats>(`/files/${entry.storageId}/${entry.id}/stats`) });
  const where = location ?? (entry.path ? entry.path : undefined);
  return (
    <aside aria-label="Detail" className={cn("flex min-h-0 flex-col bg-surface", className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3"><h2 className="flex-1 text-[14px] font-semibold">Detail</h2>{onClose && <IconButton label="Tutup detail" onClick={onClose}><X className="size-4" /></IconButton>}</header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-surface-2">
          {entry.isFolder ? <span className={cn("grid size-16 place-items-center rounded-2xl", KIND_TONE.folder)}><Icon className="size-8" aria-hidden /></span> : <FileThumb file={entry} size={256} className="size-full" />}
        </div>
        <p className="mb-2 text-[14px] font-semibold break-words">{entry.name}</p>
        <dl className="divide-y divide-line">
          <Row k="Jenis">{KIND_LABEL[kind] ?? "File"}{entry.mimeType && !entry.isFolder ? <span className="block text-[12px] text-muted">{entry.mimeType}</span> : null}</Row>
          {entry.isFolder ? (
            <Row k="Isi">{st.isLoading ? "Menghitung…" : st.data ? `${st.data.files.toLocaleString("id-ID")} file, ${st.data.folders.toLocaleString("id-ID")} folder${st.data.truncated ? " (perkiraan)" : ""}` : "–"}</Row>
          ) : null}
          <Row k="Ukuran">{entry.isFolder ? (st.data ? `${formatBytes(st.data.bytes)}${st.data.truncated ? "+" : ""}` : st.isLoading ? "Menghitung…" : "–") : `${formatBytes(entry.size)}${entry.size ? ` (${entry.size.toLocaleString("id-ID")} byte)` : ""}`}</Row>
          {storageName && <Row k="Penyimpanan">{storageName}</Row>}
          {where !== undefined && <Row k="Lokasi"><span className="font-mono text-[12px]">{where || "/"}</span></Row>}
          {entry.modifiedAt && <Row k="Diubah">{dateTime(entry.modifiedAt)}</Row>}
          {entry.createdAt && <Row k="Dibuat">{dateTime(entry.createdAt)}</Row>}
          {entry.checksum && <Row k="Checksum"><span className="font-mono text-[11px] break-all">{entry.checksum}</span></Row>}
        </dl>
      </div>
    </aside>
  );
}
