import type { FileEntry } from "@superdrive/shared";

/**
 * Builds the picture that follows the cursor while dragging: up to three stacked file cards and, for several
 * items, a count badge. It must exist in the DOM when `setDragImage` is called, then is removed.
 */
export function setDragGhost(ev: DragEvent, entries: FileEntry[], count: number, scope: HTMLElement | null) {
  if (!ev.dataTransfer) return;
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;top:-1000px;left:-1000px;width:230px;height:84px;pointer-events:none;font-family:Inter Variable,system-ui,sans-serif";
  const dark = document.documentElement.classList.contains("dark");
  const card = (e: FileEntry | undefined, i: number, n: number) => {
    const c = document.createElement("div");
    const off = (n - 1 - i) * 7;
    c.style.cssText = `position:absolute;left:${off}px;top:${off}px;width:200px;height:48px;border-radius:10px;border:1px solid ${dark ? "#2f4262" : "#d3dbe6"};background:${dark ? "#17243b" : "#fff"};box-shadow:0 6px 18px rgba(16,44,84,.22);display:flex;align-items:center;gap:10px;padding:0 12px;overflow:hidden;color:${dark ? "#e8eef8" : "#172b4d"};font-size:13px;font-weight:500`;
    if (i === n - 1 && e) {
      const imgSrc = scope?.querySelector<HTMLImageElement>(`[data-id="${CSS.escape(e.id)}"] img`);
      const t = document.createElement("div");
      t.style.cssText = `width:30px;height:30px;border-radius:6px;flex:none;overflow:hidden;background:${dark ? "#223049" : "#eaf2ff"};display:grid;place-items:center;font-size:15px`;
      if (imgSrc && imgSrc.complete && imgSrc.naturalWidth) { const im = imgSrc.cloneNode() as HTMLImageElement; im.style.cssText = "width:100%;height:100%;object-fit:cover"; t.appendChild(im); }
      else t.textContent = e.isFolder ? "📁" : "📄";
      c.appendChild(t);
      const name = document.createElement("span"); name.textContent = e.name; name.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0";
      c.appendChild(name);
    }
    return c;
  };
  const shown = entries.slice(0, 3); const n = Math.max(1, Math.min(3, count));
  for (let i = 0; i < n; i++) root.appendChild(card(i === n - 1 ? shown[0] : undefined, i, n));
  if (count > 1) {
    const b = document.createElement("div");
    b.textContent = String(count);
    b.style.cssText = "position:absolute;right:6px;top:-2px;min-width:24px;height:24px;padding:0 7px;border-radius:12px;background:#1769e8;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff;box-sizing:border-box";
    root.appendChild(b);
  }
  document.body.appendChild(root);
  ev.dataTransfer.setDragImage(root, 24, 24);
  setTimeout(() => root.remove(), 0);
}
