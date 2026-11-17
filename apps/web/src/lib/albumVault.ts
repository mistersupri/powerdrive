import { useCallback, useMemo } from "react";

interface VaultBridge { albumVaultState?(userId: string): string; enrollAlbumVault?(userId: string, password: string): void; unlockAlbumVault?(userId: string): void; clearAlbumVault?(): void }
const bridge = () => (window as unknown as { SuperDriveAndroid?: VaultBridge }).SuperDriveAndroid;
interface VaultEvent { kind: "enroll" | "unlock" | "clear"; ok: boolean; password?: string | null; error?: string | null }

/** Waits for the phone's answer to one request (the fingerprint prompt can take a while). */
const answer = (kind: VaultEvent["kind"]) => new Promise<VaultEvent>((resolve) => {
  const t = setTimeout(() => { window.removeEventListener("sd-album-vault", h); resolve({ kind, ok: false, error: "timeout" }); }, 90_000);
  function h(e: Event) { const d = (e as CustomEvent<VaultEvent>).detail; if (d.kind !== kind) return; clearTimeout(t); window.removeEventListener("sd-album-vault", h); resolve(d); }
  window.addEventListener("sd-album-vault", h);
});

/** The Android app can keep the private-album password behind the fingerprint. In a browser every method says "not available". */
export function useAlbumVault(userId: string | undefined) {
  const b = bridge();
  const state = useCallback(() => { try { return userId && b?.albumVaultState ? (JSON.parse(b.albumVaultState(userId)) as { available: boolean; enrolled: boolean }) : { available: false, enrolled: false }; } catch { return { available: false, enrolled: false }; } }, [b, userId]);
  return useMemo(() => ({
    state,
    /** The saved password after a fingerprint, or null (cancelled / not set up / fingerprints changed). */
    unlock: async (): Promise<string | null> => { if (!userId || !b?.unlockAlbumVault) return null; const p = answer("unlock"); b.unlockAlbumVault(userId); const r = await p; return r.ok ? r.password ?? null : null; },
    enroll: async (password: string): Promise<boolean> => { if (!userId || !b?.enrollAlbumVault) return false; const p = answer("enroll"); b.enrollAlbumVault(userId, password); return (await p).ok; },
    clear: async () => { if (!b?.clearAlbumVault) return; const p = answer("clear"); b.clearAlbumVault(); await p; },
  }), [state, userId, b]);
}
