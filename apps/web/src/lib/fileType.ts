import { File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Presentation, type LucideIcon } from "lucide-react";
import type { FileEntry } from "@superdrive/shared";

export type FileKind = "folder" | "image" | "video" | "audio" | "pdf" | "text" | "sheet" | "slides" | "doc" | "archive" | "code" | "other";

const EXT: Record<string, FileKind> = {
  pdf: "pdf", doc: "doc", docx: "doc", odt: "doc", rtf: "doc", txt: "text", md: "text", log: "text",
  xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet", ppt: "slides", pptx: "slides", odp: "slides",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", tgz: "archive",
  js: "code", ts: "code", json: "code", html: "code", css: "code", py: "code", sh: "code", xml: "code", yml: "code", yaml: "code",
};
export function kindOf(f: Pick<FileEntry, "isFolder" | "mimeType" | "name">): FileKind {
  if (f.isFolder) return "folder";
  const m = f.mimeType ?? "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? (m === "application/pdf" ? "pdf" : m.startsWith("text/") ? "text" : "other");
}
export const KIND_ICON: Record<FileKind, LucideIcon> = {
  folder: Folder, image: FileImage, video: FileVideo, audio: FileAudio, pdf: FileText, text: FileText, sheet: FileSpreadsheet,
  slides: Presentation, doc: FileText, archive: FileArchive, code: FileCode, other: File,
};
/** Tinted icon colors per kind. Color here is a hint, never the only signal — the icon shape differs too. */
export const KIND_TONE: Record<FileKind, string> = {
  folder: "text-primary-ink bg-primary-soft", image: "text-violet-ink bg-violet-soft", video: "text-danger-ink bg-danger-soft",
  audio: "text-warn-ink bg-warn-soft", pdf: "text-danger-ink bg-danger-soft", text: "text-muted bg-surface-2", sheet: "text-ok-ink bg-ok-soft",
  slides: "text-warn-ink bg-warn-soft", doc: "text-primary-ink bg-primary-soft", archive: "text-muted bg-surface-2", code: "text-muted bg-surface-2", other: "text-muted bg-surface-2",
};
export const previewable = (k: FileKind) => ["image", "video", "audio", "pdf", "text"].includes(k);
