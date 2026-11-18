import type { createBrowserRouter } from "react-router";
import { isAndroidApp } from "./platform";

type Router = ReturnType<typeof createBrowserRouter>;
interface ShellBridge { routeChanged?(path: string): void; setNavVisible?(on: boolean): void; setBadge?(count: number): void }
const bridge = () => (window as unknown as { SuperDriveAndroid?: ShellBridge }).SuperDriveAndroid;

/** Hides the app's native bottom bar while something covers the screen (the full-screen viewer). */
export function setNavVisible(on: boolean) { try { bridge()?.setNavVisible?.(on); } catch { /* not in the app */ } }
export function setNavBadge(count: number) { try { bridge()?.setBadge?.(count); } catch { /* not in the app */ } }

/**
 * Inside the Android app the bottom bar and the back gesture belong to the app itself. This wires the page to it:
 * the app tells the page where to go, the page tells the app where it is, and the back gesture closes whatever is on top first.
 */
export function startNativeShell(router: Router) {
  if (!isAndroidApp()) return;
  const w = window as unknown as { __sdNavigate?(path: string): void; __sdBack?(): boolean };
  // A tab change replaces the entry instead of piling up history, so back from any tab goes home, then out. The app animates tab changes itself.
  w.__sdNavigate = (path) => {
    document.documentElement.dataset.nativeNav = "1"; setTimeout(() => { delete document.documentElement.dataset.nativeNav; }, 500);
    void router.navigate(path, { replace: true });
  };
  w.__sdBack = () => {
    // 1. whatever is open on top of the page
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (dialog) { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); return true; }
    if (document.querySelector("[role=menu]")) { dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return true; }
    const scrim = document.querySelector<HTMLElement>("[role=dialog][aria-label=Menu] .anim-fade");
    if (scrim) { scrim.click(); return true; }
    // 2. the viewer / earlier pages
    const st = history.state as { idx?: number; sdPreview?: boolean } | null;
    if (st?.sdPreview || (st?.idx ?? 0) > 0) { history.back(); return true; }
    // 3. a tab other than home goes home first
    if (router.state.location.pathname !== "/") { void router.navigate("/", { replace: true }); return true; }
    return false; // nothing left: the app may close
  };
  const report = (path: string) => { try { bridge()?.routeChanged?.(path); } catch { /* ignore */ } };
  report(router.state.location.pathname);
  return router.subscribe((s) => report(s.location.pathname));
}
