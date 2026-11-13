import type { FileEntry } from "@superdrive/shared";
import { previewKind } from "@/lib/fileType";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Kinds that can be printed straight from the browser without converting anything. */
export const printable = (f: FileEntry) => { const k = previewKind(f); return k === "image" || k === "pdf" || k === "text" || k === "json" || k === "csv"; };

/** Print through a hidden same-origin iframe, so the page behind keeps its state. */
export async function printFile(f: FileEntry, url: string): Promise<void> {
  const k = previewKind(f); if (!k) throw new Error("Jenis file ini tidak bisa dicetak.");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true"); frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  const cleanup = () => setTimeout(() => frame.remove(), 60_000);
  const run = () => { const w = frame.contentWindow; if (!w) return frame.remove(); w.focus(); w.print(); cleanup(); };
  if (k === "pdf") {
    frame.src = url; frame.onload = () => setTimeout(run, 400); document.body.append(frame); return;
  }
  if (k === "image") {
    frame.srcdoc = `<!doctype html><title>${esc(f.name)}</title><style>@page{margin:10mm}html,body{margin:0}img{display:block;max-width:100%;max-height:100vh;margin:0 auto;object-fit:contain}</style><img src="${esc(new URL(url, location.href).href)}" alt="">`;
    frame.onload = () => { const img = frame.contentDocument?.querySelector("img"); if (img && !img.complete) img.onload = run; else run(); };
    document.body.append(frame); return;
  }
  const res = await fetch(url, { credentials: "same-origin" }); if (!res.ok) throw new Error("Gagal memuat file untuk dicetak.");
  const text = (await res.text()).slice(0, 2_000_000);
  frame.srcdoc = `<!doctype html><title>${esc(f.name)}</title><style>@page{margin:15mm}body{font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}</style><body>${esc(text)}</body>`;
  frame.onload = run; document.body.append(frame);
}
