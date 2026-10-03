import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { FolderGlyph } from "../../ui/FileTypeIcon.tsx";
import type { useItemDragDrop } from "./useItemDragDrop.ts";

export interface BreadcrumbItem {
  /** Drop target id for this crumb (ROOT_TARGET for the root). */
  targetId: string;
  label: string;
  icon?: React.ReactNode;
}

type Dnd = ReturnType<typeof useItemDragDrop>;

/**
 * Path bar. While items are being dragged every crumb is a drop target, and
 * hovering one opens its subfolders so items can be dropped one level deeper
 * without navigating first.
 */
export function Breadcrumbs({
  items,
  onNavigate,
  dnd,
  loadChildren,
}: {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
  dnd: Dnd;
  loadChildren?: (targetId: string) => Promise<{ id: string; name: string }[]>;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const [openCrumb, setOpenCrumb] = useState<string | null>(null);
  const [children, setChildren] = useState<Record<string, { loading: boolean; list: { id: string; name: string }[] }>>({});
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the current folder in view on narrow screens.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items]);

  useEffect(() => {
    if (!dnd.isDragging) setOpenCrumb(null);
  }, [dnd.isDragging]);

  const ensureChildren = (targetId: string) => {
    if (!loadChildren || children[targetId]) return;
    setChildren((prev) => ({ ...prev, [targetId]: { loading: true, list: [] } }));
    loadChildren(targetId)
      .then((list) => setChildren((prev) => ({ ...prev, [targetId]: { loading: false, list } })))
      .catch(() => setChildren((prev) => ({ ...prev, [targetId]: { loading: false, list: [] } })));
  };

  return (
    <nav aria-label="Lokasi folder" className="min-w-0 flex-1">
      <ol ref={scrollRef} className={cn("flex items-center gap-0.5 text-sm min-w-0", dnd.isDragging ? "overflow-visible" : "overflow-x-auto")}>
        {items.map((crumb, idx) => {
          const isLast = idx === items.length - 1;
          const isOver = dnd.overTarget === crumb.targetId;
          const showChildren = dnd.isDragging && openCrumb === crumb.targetId && !!loadChildren;
          const kids = children[crumb.targetId];
          return (
            <li
              key={`${crumb.targetId}-${idx}`}
              className="flex items-center shrink-0 relative"
              onDragEnter={() => {
                if (!dnd.isDragging) return;
                if (openTimer.current) clearTimeout(openTimer.current);
                openTimer.current = setTimeout(() => {
                  setOpenCrumb(crumb.targetId);
                  ensureChildren(crumb.targetId);
                }, 350);
              }}
              onDragLeave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                if (openTimer.current) clearTimeout(openTimer.current);
                setOpenCrumb((cur) => (cur === crumb.targetId ? null : cur));
              }}
            >
              {idx > 0 && <ChevronRight className="w-4 h-4 text-ink-400 shrink-0" aria-hidden />}
              <button
                type="button"
                {...dnd.dropTargetProps(crumb.targetId)}
                onClick={() => onNavigate(idx)}
                aria-current={isLast ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 h-8 px-2 rounded-lg whitespace-nowrap transition-colors max-w-[14rem]",
                  isLast ? "font-bold text-ink-900" : "font-medium text-ink-500 hover:text-ink-900 hover:bg-ink-100",
                  isOver && "bg-accent-100 text-ink-900 ring-2 ring-accent-600"
                )}
              >
                {crumb.icon}
                <span className="truncate">{crumb.label}</span>
              </button>

              {showChildren && (
                <div className="absolute top-full left-0 pt-1.5 z-50 w-64">
                  <div className="bg-surface border border-ink-200 rounded-xl shadow-float p-1 animate-pop-in origin-top-left">
                    <div className="px-2.5 py-1.5 text-xs text-ink-500 truncate">Lepas ke dalam {crumb.label}</div>
                    {kids?.loading ? (
                      <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-ink-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> Memuat folder
                      </div>
                    ) : !kids || kids.list.length === 0 ? (
                      <div className="px-2.5 py-2 text-sm text-ink-500">Tidak ada subfolder</div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto">
                        {kids.list
                          .filter((k) => !dnd.dragKeys?.includes(`folder_${k.id}`))
                          .map((k) => (
                            <div
                              key={k.id}
                              {...dnd.dropTargetProps(k.id)}
                              className={cn(
                                "flex items-center gap-2 h-9 px-2.5 rounded-lg text-sm font-medium text-ink-800",
                                dnd.overTarget === k.id && "bg-accent-100 ring-2 ring-accent-600"
                              )}
                            >
                              <FolderGlyph className="w-4 h-4" />
                              <span className="truncate">{k.name}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
