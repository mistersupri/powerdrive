import { toast } from "sonner";

const readCookie = (k: string) => document.cookie.split("; ").find((c) => c.startsWith(k + "="))?.slice(k.length + 1);

/**
 * Downloads are handed to the browser (so it keeps native progress, cancel and resume), but a browser may show
 * nothing until the first byte arrives — which for a cloud file or a big ZIP can take a while. The server stamps a
 * cookie the moment it starts sending; until then we show a "preparing" toast so the tap never feels ignored.
 */
export function startDownload(target: string | { action: string; fields: [string, string][] }, label: string) {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const withToken = (u: string) => `${u}${u.includes("?") ? "&" : "?"}dlt=${token}`;
  if (typeof target === "string") {
    const a = document.createElement("a"); a.href = withToken(target); a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove();
  } else {
    const f = document.createElement("form"); f.method = "POST"; f.action = withToken(target.action); f.style.display = "none";
    for (const [k, v] of target.fields) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
    document.body.appendChild(f); f.submit(); f.remove();
  }
  const id = toast.loading(`Menyiapkan unduhan ${label}…`, { description: "Unduhan akan muncul di notifikasi browser." });
  const started = Date.now();
  const t = setInterval(() => {
    if (readCookie("sd_dl") === token) { clearInterval(t); document.cookie = "sd_dl=; Max-Age=0; Path=/"; toast.success(`Unduhan dimulai: ${label}`, { id, description: "Lihat kemajuannya di notifikasi atau daftar unduhan browser.", duration: 4000 }); }
    else if (Date.now() - started > 120_000) { clearInterval(t); toast.dismiss(id); }
  }, 250);
}
