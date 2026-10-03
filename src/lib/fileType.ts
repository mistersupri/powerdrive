export type FileCategory =
  | "image"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "other";

const EXT: Record<Exclude<FileCategory, "other">, string[]> = {
  image: ["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "heic", "avif"],
  pdf: ["pdf"],
  spreadsheet: ["xlsx", "xls", "csv", "ods"],
  document: ["docx", "doc", "odt", "rtf"],
  presentation: ["pptx", "ppt", "odp"],
  video: ["mp4", "webm", "mkv", "mov", "avi", "m4v"],
  audio: ["mp3", "wav", "ogg", "aac", "m4a", "flac"],
  archive: ["zip", "rar", "7z", "tar", "gz"],
  code: ["js", "ts", "tsx", "jsx", "html", "css", "json", "py", "sql", "txt", "md", "xml", "yml", "yaml"],
};

export function fileExtension(name = ""): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function getFileCategory(mimeType = "", name = ""): FileCategory {
  const ext = fileExtension(name);
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || EXT.image.includes(ext)) return "image";
  if (mime.includes("pdf") || EXT.pdf.includes(ext)) return "pdf";
  if (mime.includes("sheet") || mime.includes("excel") || EXT.spreadsheet.includes(ext)) return "spreadsheet";
  if (mime.includes("presentation") || mime.includes("powerpoint") || EXT.presentation.includes(ext)) return "presentation";
  if (mime.includes("word") || mime.includes("document") || EXT.document.includes(ext)) return "document";
  if (mime.startsWith("video/") || EXT.video.includes(ext)) return "video";
  if (mime.startsWith("audio/") || EXT.audio.includes(ext)) return "audio";
  if (mime.includes("zip") || mime.includes("compressed") || EXT.archive.includes(ext)) return "archive";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript") || EXT.code.includes(ext)) return "code";
  return "other";
}

export const categoryLabel: Record<FileCategory, string> = {
  image: "Gambar",
  pdf: "PDF",
  spreadsheet: "Spreadsheet",
  document: "Dokumen",
  presentation: "Presentasi",
  video: "Video",
  audio: "Audio",
  archive: "Arsip",
  code: "Teks",
  other: "Berkas",
};
