import type { FileEntry } from "@superdrive/shared";
import { useCallback, useRef, useState } from "react";

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const clear = useCallback(() => { setSelected(new Set()); anchor.current = null; }, []);
  const click = useCallback((id: string, ordered: FileEntry[], mods: { shift?: boolean; additive?: boolean }) => {
    setSelected((cur) => {
      if (mods.shift && anchor.current) {
        const a = ordered.findIndex((e) => e.id === anchor.current); const b = ordered.findIndex((e) => e.id === id);
        if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; return new Set(ordered.slice(lo, hi + 1).map((e) => e.id)); }
      }
      anchor.current = id;
      if (mods.additive) { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }
      return new Set([id]);
    });
  }, []);
  const selectAll = useCallback((ordered: FileEntry[]) => setSelected(new Set(ordered.map((e) => e.id))), []);
  const only = useCallback((id: string) => { anchor.current = id; setSelected(new Set([id])); }, []);
  return { selected, setSelected, click, clear, selectAll, only };
}
export type Selection = ReturnType<typeof useSelection>;
