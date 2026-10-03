import { useCallback, useState } from "react";

/** useState that remembers its value in localStorage (a per-browser convenience only). */
export function usePersistentState<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage unavailable; the value still applies for this session.
      }
    },
    [key]
  );
  return [value, set] as const;
}
