import { useSyncExternalStore } from "react";

/** Tiny observable store: components subscribe with a selector, the producer calls `set`. */
export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((s: T) => T)) { state = typeof next === "function" ? (next as (s: T) => T)(state) : next; subs.forEach((f) => f()); },
    subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); },
    use<S>(select: (s: T) => S): S { return useSyncExternalStore(this.subscribe, () => select(state)); },
  };
}
