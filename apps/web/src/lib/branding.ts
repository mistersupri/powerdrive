import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";

export interface Branding { appName: string; color: string; defaultTheme: "light" | "dark" | "system"; loginMessage: string; iconUrl: string | null; registration: "open" | "invite" | "closed" }
export const DEFAULT_BRANDING: Branding = { appName: "SuperDrive", color: "#1769e8", defaultTheme: "light", loginMessage: "", iconUrl: null, registration: "open" };

export const useBranding = () => useQuery({ queryKey: ["branding"], queryFn: () => api<Branding>("/branding"), staleTime: 5 * 60_000, retry: 1 });

/* Accent colours: the admin picks one colour, the rest of the scale is derived and checked for contrast, so a custom accent never makes text unreadable. */
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i]! - v) * t)); };
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Move `c` toward `toward` until it reaches `min`:1 against `bg` (or give up after a few steps). */
const ensure = (c: string, bg: string, toward: string, min = 4.5) => { let out = c; for (let i = 0; i < 12 && contrast(out, bg) < min; i++) out = mix(out, toward, 0.12); return out; };

export function accentVars(color: string) {
  const light = { "--primary": color, "--primary-hover": mix(color, "#000000", 0.14), "--primary-soft": mix(color, "#ffffff", 0.92), "--primary-ink": "" };
  light["--primary-ink"] = ensure(color, light["--primary-soft"], "#000000");
  const dsurf = "#17243b"; const dark = { "--primary": color, "--primary-hover": mix(color, "#ffffff", 0.14), "--primary-soft": mix(color, "#111b2e", 0.78), "--primary-ink": ensure(mix(color, "#ffffff", 0.35), dsurf, "#ffffff") };
  return { light, dark };
}
const css = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(";");

export function applyBranding(b: Branding) {
  const { light, dark } = accentVars(b.color);
  let st = document.getElementById("sd-brand") as HTMLStyleElement | null; if (!st) { st = document.createElement("style"); st.id = "sd-brand"; document.head.appendChild(st); }
  st.textContent = `:root{${css(light)}}.dark{${css(dark)}}`;
  document.title = b.appName;
  const link = (rel: string) => { let l = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`); if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); } return l; };
  if (b.iconUrl) { const i = link("icon"); i.type = "image/png"; i.href = b.iconUrl.replace("/192", "/32"); link("apple-touch-icon").href = b.iconUrl; }
  let m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'); if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); } m.content = b.color;
  // First visit only: follow the admin's default theme until the person picks their own.
  try { if (!localStorage.getItem("sd-theme")) document.documentElement.classList.toggle("dark", b.defaultTheme === "dark" || (b.defaultTheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)); } catch { /* ignore */ }
}

/** Mounted once at the root: fetches the public branding and applies it. */
export function BrandingApplier() {
  const q = useBranding();
  useEffect(() => { if (q.data) applyBranding(q.data); }, [q.data]);
  return null;
}
