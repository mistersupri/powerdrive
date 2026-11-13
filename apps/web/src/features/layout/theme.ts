import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
export function setTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem("sd-theme", t); } catch { /* ignore */ }
  window.dispatchEvent(new Event("sd-theme"));
}
export function useTheme() {
  const [t, setT] = useState<Theme>(read);
  useEffect(() => { const f = () => setT(read()); window.addEventListener("sd-theme", f); return () => window.removeEventListener("sd-theme", f); }, []);
  return { theme: t, toggle: () => setTheme(t === "dark" ? "light" : "dark") };
}
