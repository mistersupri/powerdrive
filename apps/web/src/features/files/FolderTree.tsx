import type { FileEntry, FileListing } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderOpen, HardDrive, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePersistentState } from "@/lib/usePersistentState";
import { DRAG_MIME, activeDrag } from "./dnd";
import type { DropPayload } from "./CrumbDrop";

interface Ctx {
  storageId: string; current: string; expanded: Set<string>; toggle(id: string, on?: boolean): void; go(id: string): void;
  drop(target: string, p: DropPayload, copy: boolean): void; over: string; setOver(id: string): void;
}

/** Folders only, loaded lazily one level at a time. Keys start with ["files", storageId] so any file change refreshes the tree too. */
function useChildren(storageId: string, folderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["files", storageId, "tree", folderId], enabled, staleTime: 20_000,
    queryFn: async () => {
      const out: FileEntry[] = []; let token: string | undefined;
      do {
        const r = await api<FileListing>(`/files?storageId=${storageId}&folderId=${encodeURIComponent(folderId)}&foldersOnly=true&limit=500${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
        out.push(...r.items); token = r.nextPageToken ?? undefined;
      } while (token);
      return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    },
  });
}

function Node({ c, id, name, depth, root }: { c: Ctx; id: string; name: string; depth: number; root?: boolean }) {
  const open = c.expanded.has(id); const q = useChildren(c.storageId, id, open);
  const empty = q.isSuccess && q.data.length === 0; const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = c.current === id; const over = c.over === id;
  return (
    <li role="none">
      <div role="treeitem" aria-expanded={empty ? undefined : open} aria-selected={active} aria-level={depth + 1} tabIndex={-1} data-tree-id={id}
        className={cn("group flex h-8 cursor-default items-center rounded-lg pr-2 text-[13px] transition-colors select-none", active ? "bg-primary-soft font-medium text-primary-ink" : "hover:bg-surface-2", over && "bg-primary-soft ring-2 ring-primary")}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => c.go(id)}
        onDragOver={(e) => { if (!e.dataTransfer.types.includes(DRAG_MIME) || activeDrag?.ids.includes(id)) return; e.preventDefault(); e.stopPropagation(); c.setOver(id); if (!open && !empty && !hover.current) hover.current = setTimeout(() => c.toggle(id, true), 700); }}
        onDragLeave={() => { clearTimeout(hover.current); hover.current = undefined; if (c.over === id) c.setOver(""); }}
        onDrop={(e) => { clearTimeout(hover.current); hover.current = undefined; c.setOver(""); const raw = e.dataTransfer.getData(DRAG_MIME); if (!raw) return; e.preventDefault(); e.stopPropagation(); c.drop(id, JSON.parse(raw), e.altKey); }}>
        <button aria-label={open ? "Ciutkan" : "Buka"} tabIndex={-1} className={cn("grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-line", empty && "invisible")} onClick={(e) => { e.stopPropagation(); c.toggle(id); }}>
          {open && q.isFetching && !q.data ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
        </button>
        {root ? <HardDrive className="mr-1.5 size-4 shrink-0 text-primary-ink" aria-hidden /> : open || active ? <FolderOpen className="mr-1.5 size-4 shrink-0 text-primary-ink" aria-hidden /> : <Folder className="mr-1.5 size-4 shrink-0 text-primary-ink" aria-hidden />}
        <span className="truncate" title={name}>{name}</span>
      </div>
      {open && q.data && q.data.length > 0 && <ul role="group">{q.data.map((f) => <Node key={f.id} c={c} id={f.id} name={f.name} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function FolderTree({ storageId, rootLabel, current, pathIds, onNavigate, onDrop }: { storageId: string; rootLabel: string; current: string; pathIds: string[]; onNavigate(id: string): void; onDrop(target: string, p: DropPayload, copy: boolean): void }) {
  const [saved, setSaved] = usePersistentState<string[]>(`sd-tree:${storageId}`, ["root"]);
  const expanded = new Set(saved); const [over, setOver] = useState("");
  // Keep the path to the current folder open, so the tree always shows where you are.
  useEffect(() => {
    const need = ["root", ...pathIds].filter((id) => !expanded.has(id));
    if (need.length) setSaved([...new Set([...saved, ...need])]);
  }, [pathIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const clear = () => setTimeout(() => setOver(""), 0); window.addEventListener("dragend", clear, true); window.addEventListener("drop", clear, true); return () => { window.removeEventListener("dragend", clear, true); window.removeEventListener("drop", clear, true); }; }, []);
  const ctx: Ctx = {
    storageId, current, expanded, go: onNavigate, drop: onDrop, over, setOver,
    toggle: (id, on) => { const has = expanded.has(id); const want = on ?? !has; if (want === has) return; setSaved(want ? [...saved, id] : saved.filter((x) => x !== id)); },
  };
  return (
    <nav aria-label="Pohon folder" className="scroll-thin h-full overflow-y-auto p-2">
      <ul role="tree"><Node c={ctx} id="root" name={rootLabel} depth={0} root /></ul>
    </nav>
  );
}
