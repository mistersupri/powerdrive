import { toast } from "sonner";
import { api } from "@/lib/api";

const readCookie = (k: string) => document.cookie.split("; ").find((c) => c.startsWith(k + "="))?.slice(k.length + 1);

/** The Android app exposes a small bridge; there the system download manager shows progress, so no waiting toast is needed. */
const native = () => (window as unknown as { SuperDriveAndroid?: { isApp(): boolean } }).SuperDriveAndroid;

/**
 * Downloads are handed to the browser (so it keeps native progress, cancel and resume), but a browser may show
 * nothing until the first byte arrives , which for a cloud file or a big ZIP can take a while. The server stamps a
 * cookie the moment it starts sending; until then we show a "preparing" toast so the tap never feels ignored.
 */
export function startDownload(target: string | { action: string; fields: [string, string][] }, label: string) {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const withToken = (u: string) => `${u}${u.includes("?") ? "&" : "?"}dlt=${token}`;
  const go = (url: string) => { const a = document.createElement("a"); a.href = withToken(url); a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); };
  const id = toast.loading(`Menyiapkan unduhan ${label}…`, { description: native() ? undefined : "Unduhan akan muncul di notifikasi browser." });
  const started = Date.now();
  if (native()) { toast.success(`Mengunduh ${label}`, { id, description: "Kemajuan tampil di notifikasi.", duration: 3500 }); }
  if (typeof target === "string") go(target);
  else {
    // Several items: ask for a ticket (POST), then download it with a plain GET. Works the same in browsers and in the Android app.
    const body: Record<string, string | string[]> = {}; for (const [k, v] of target.fields) body[k] = k === "id" ? [...((body[k] as string[]) ?? []), v] : v;
    void api<{ path: string }>(target.action.replace(/^\/api\/v1/, "") + "-ticket", { body }).then((r) => go(r.path)).catch((e) => { toast.error((e as Error).message, { id }); });
  }
  if (native()) return;
  const t = setInterval(() => {
    if (readCookie("sd_dl") === token) { clearInterval(t); document.cookie = "sd_dl=; Max-Age=0; Path=/"; toast.success(`Unduhan dimulai: ${label}`, { id, description: "Lihat kemajuannya di notifikasi atau daftar unduhan browser.", duration: 4000 }); }
    else if (Date.now() - started > 120_000) { clearInterval(t); toast.dismiss(id); }
  }, 250);
}
