import { useCallback, useState } from "react";

/** useState that survives reloads. Storage can be unavailable (private mode), so every access is guarded. */
export function usePersistentState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : initial; } catch { return initial; } });
  const set = useCallback((n: T) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } }, [key]);
  return [v, set] as const;
}
