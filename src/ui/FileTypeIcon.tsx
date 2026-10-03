import React from "react";
import {
  File as FileGeneric,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Music,
  Presentation,
  Video,
} from "lucide-react";
import { FileCategory, getFileCategory } from "../lib/fileType.ts";
import { cn } from "../lib/cn.ts";

// Icon shape alone tells file types apart; color is reserved for sync status (DESIGN.md).
const ICONS: Record<FileCategory, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  image: ImageIcon,
  pdf: FileText,
  spreadsheet: FileSpreadsheet,
  document: FileText,
  presentation: Presentation,
  video: Video,
  audio: Music,
  archive: FileArchive,
  code: FileCode,
  other: FileGeneric,
};

export function FileTypeIcon({
  mimeType,
  name,
  category,
  className,
}: {
  mimeType?: string;
  name?: string;
  category?: FileCategory;
  className?: string;
}) {
  const Icon = ICONS[category ?? getFileCategory(mimeType, name)];
  return <Icon className={cn("w-5 h-5 text-ink-500 shrink-0", className)} strokeWidth={1.75} aria-hidden />;
}

/** Filled folder glyph used for every folder in the app, so folders read as one family. */
export function FolderGlyph({ className }: { className?: string }) {
  return <Folder className={cn("w-5 h-5 text-ink-700 fill-ink-200 shrink-0", className)} strokeWidth={1.75} aria-hidden />;
}
