import React, { useEffect, useRef } from "react";
import { AlertTriangle, Check, LayoutGrid, List, Loader2, RotateCw, Search, UploadCloud, X } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../../ui/Button.tsx";
import { FolderGlyph } from "../../ui/FileTypeIcon.tsx";

type ItemProps = Record<string, unknown>;

/* ---------- selection checkbox ---------- */

function SelectToggle({
  selected,
  onToggle,
  label,
  className,
}: {
  selected: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "pressable absolute z-10 w-6 h-6 rounded-md flex items-center justify-center border",
        selected
          ? "bg-accent-600 border-accent-600 text-accent-fg"
          : "bg-surface/90 border-ink-300 text-transparent hover:text-ink-400 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:opacity-100",
        className
      )}
    >
      <Check className="w-3.5 h-3.5" strokeWidth={3} />
    </button>
  );
}

/* ---------- grid cards ---------- */

/** Folders are navigation, so they are compact rows of a grid: icon, name, one line of meta. */
export function FolderCard({
  name,
  meta,
  badge,
  selected,
  dropActive,
  itemProps,
  onToggle,
}: {
  name: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  selected: boolean;
  dropActive?: boolean;
  itemProps: ItemProps;
  onToggle: () => void;
}) {
  return (
    <div
      {...itemProps}
      role="option"
      className={cn(
        "group relative flex items-center gap-3 h-[60px] pl-3 pr-10 rounded-xl border bg-surface select-none outline-none",
        "transition-[border-color,background-color,box-shadow] duration-150",
        selected ? "border-accent-600 bg-accent-50 ring-1 ring-accent-600" : "border-ink-200 hover:border-ink-300 hover:bg-ink-50",
        dropActive && "border-accent-600 bg-accent-100 ring-2 ring-accent-600",
        "focus-visible:ring-2 focus-visible:ring-accent-600"
      )}
    >
      <FolderGlyph className="w-6 h-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-ink-900 truncate" title={name}>
            {name}
          </span>
        </div>
        {meta && <div className="text-xs text-ink-500 truncate tabular">{meta}</div>}
      </div>
      {badge}
      <SelectToggle selected={selected} onToggle={onToggle} label={selected ? `Batal pilih ${name}` : `Pilih ${name}`} className="right-2.5 top-1/2 -translate-y-1/2" />
    </div>
  );
}

export function FileCard({
  name,
  thumbnail,
  meta,
  status,
  corner,
  selected,
  itemProps,
  onToggle,
}: {
  name: string;
  thumbnail: React.ReactNode;
  meta?: React.ReactNode;
  status?: React.ReactNode;
  corner?: React.ReactNode;
  selected: boolean;
  itemProps: ItemProps;
  onToggle: () => void;
}) {
  return (
    <div
      {...itemProps}
      role="option"
      className={cn(
        "group relative flex flex-col rounded-xl border bg-surface overflow-hidden select-none outline-none",
        "transition-[border-color,box-shadow] duration-150",
        selected ? "border-accent-600 ring-1 ring-accent-600" : "border-ink-200 hover:border-ink-300",
        "focus-visible:ring-2 focus-visible:ring-accent-600"
      )}
    >
      <div className="relative">
        {thumbnail}
        {selected && <div className="absolute inset-0 bg-accent-600/10 pointer-events-none" />}
        {corner && <div className="absolute top-2 left-2">{corner}</div>}
      </div>
      <SelectToggle selected={selected} onToggle={onToggle} label={selected ? `Batal pilih ${name}` : `Pilih ${name}`} className="top-2 right-2" />
      <div className="px-3 pt-2.5 pb-3 min-w-0">
        <div className="text-sm font-semibold text-ink-900 truncate" title={name}>
          {name}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 min-h-5">
          <span className="text-xs text-ink-500 truncate tabular">{meta}</span>
          {status}
        </div>
      </div>
    </div>
  );
}

export function ItemGrid({ kind, children, label }: { kind: "folders" | "files"; children: React.ReactNode; label: string }) {
  return (
    <div
      role="listbox"
      aria-multiselectable="true"
      aria-label={label}
      className={cn(
        "grid gap-3",
        kind === "folders"
          ? "grid-cols-1 min-[440px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
      )}
    >
      {children}
    </div>
  );
}

/* ---------- table ---------- */

export interface Column {
  label: string;
  className?: string;
}

export function ItemTable({
  columns,
  allSelected,
  onToggleAll,
  children,
  label,
}: {
  columns: Column[];
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="bg-surface border border-ink-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[640px] text-left text-sm" aria-label={label}>
          <thead>
            <tr className="border-b border-ink-200 text-xs font-semibold text-ink-500 whitespace-nowrap">
              <th className="w-10 pl-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Pilih semua"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="w-4 h-4 rounded border-ink-300 align-middle"
                />
              </th>
              {columns.map((c) => (
                <th key={c.label} className={cn("px-3 py-2.5 font-semibold", c.className)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function ItemRow({
  selected,
  dropActive,
  itemProps,
  onToggle,
  name,
  children,
}: {
  selected: boolean;
  dropActive?: boolean;
  itemProps: ItemProps;
  onToggle: () => void;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <tr
      {...itemProps}
      className={cn(
        "select-none outline-none transition-colors duration-100 whitespace-nowrap",
        selected ? "bg-accent-50" : "hover:bg-ink-50",
        dropActive && "bg-accent-100 outline-2 -outline-offset-2 outline-accent-600",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600"
      )}
    >
      <td className="w-10 pl-3 py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={selected ? `Batal pilih ${name}` : `Pilih ${name}`}
          checked={selected}
          onChange={onToggle}
          className="w-4 h-4 rounded border-ink-300 align-middle"
        />
      </td>
      {children}
    </tr>
  );
}

export function NameCell({ icon, name, sub, badge }: { icon: React.ReactNode; name: string; sub?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <td className="px-3 py-2 max-w-0 w-[45%]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-8 h-8 rounded-lg bg-ink-100 flex items-center justify-center shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-ink-900 truncate" title={name}>
              {name}
            </span>
            {badge}
          </div>
          {sub && <div className="text-xs text-ink-500 truncate">{sub}</div>}
        </div>
      </div>
    </td>
  );
}

export function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 text-ink-600 tabular", className)}>{children}</td>;
}

/* ---------- layout helpers ---------- */

export function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-sm font-bold text-ink-800">
        {title}
        {count !== undefined && <span className="ml-1.5 font-semibold text-ink-500 tabular">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 min-w-0 sm:max-w-xs">
      <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-10 sm:h-9 pl-9 pr-8 rounded-lg bg-surface border border-ink-200 text-base sm:text-sm text-ink-900 placeholder:text-ink-400 hover:border-ink-300 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Hapus pencarian"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function ViewToggle({ value, onChange }: { value: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  const opt = (v: "grid" | "list", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value === v}
      title={label}
      onClick={() => onChange(v)}
      className={cn(
        "w-9 h-9 sm:w-8 sm:h-8 rounded-md flex items-center justify-center transition-colors",
        value === v ? "bg-ink-100 text-ink-900" : "text-ink-500 hover:text-ink-900"
      )}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center p-0.5 rounded-lg border border-ink-200 bg-surface" role="group" aria-label="Tampilan">
      {opt("grid", "Tampilan kisi", <LayoutGrid className="w-4 h-4" />)}
      {opt("list", "Tampilan daftar", <List className="w-4 h-4" />)}
    </div>
  );
}

/** Floating bar shown while items are selected. Sits above the mobile nav. */
export function SelectionDock({
  count,
  summary,
  onClear,
  onSelectAll,
  children,
}: {
  count: number;
  summary?: string;
  onClear: () => void;
  onSelectAll: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="fixed z-40 inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 md:left-60 md:right-0 mx-auto md:w-fit md:max-w-[calc(100vw-17rem)] pointer-events-none">
      <div
        role="toolbar"
        aria-label="Tindakan untuk item terpilih"
        className="pointer-events-auto flex items-center gap-1 p-1.5 rounded-2xl bg-night-900 text-night-50 ring-1 ring-white/10 shadow-float animate-slide-up overflow-x-auto"
      >
        <button
          type="button"
          onClick={onClear}
          aria-label="Batal pilih (Esc)"
          title="Batal pilih (Esc)"
          className="pressable w-9 h-9 rounded-xl flex items-center justify-center text-night-300 hover:text-white hover:bg-night-800 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="px-1.5 pr-2 shrink-0">
          <div className="text-sm font-bold tabular whitespace-nowrap">{count} dipilih</div>
          {summary && <div className="text-[11px] text-night-300 tabular whitespace-nowrap hidden sm:block">{summary}</div>}
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          className="hidden sm:block h-9 px-2.5 rounded-xl text-xs font-semibold text-night-300 hover:text-white hover:bg-night-800 shrink-0"
        >
          Pilih semua
        </button>
        <div className="w-px h-6 bg-night-700 mx-1 shrink-0" />
        <div className="flex items-center gap-0.5">{children}</div>
      </div>
    </div>
  );
}

export function DockAction({
  icon,
  label,
  onClick,
  href,
  download,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  download?: string;
  danger?: boolean;
}) {
  const cls = cn(
    "pressable h-9 px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0",
    danger ? "text-danger-400 hover:bg-danger-500/15" : "text-night-100 hover:bg-night-800"
  );
  if (href) {
    return (
      <a href={href} download={download} className={cls} title={label}>
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={label} aria-label={label}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/* ---------- states ---------- */

export function TopProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="absolute top-0 inset-x-0 h-0.5 overflow-hidden z-30" role="progressbar" aria-label="Memuat">
      <div className="h-full w-2/5 bg-accent-600 animate-progress" />
    </div>
  );
}

export function ItemsSkeleton({ files = true }: { files?: boolean }) {
  return (
    <div className="space-y-8" aria-hidden>
      <div>
        <div className="h-4 w-24 rounded bg-ink-100 mb-3" />
        <div className="grid gap-3 grid-cols-1 min-[440px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[60px] rounded-xl border border-ink-200 bg-surface flex items-center gap-3 px-3 animate-pulse">
              <div className="w-6 h-6 rounded bg-ink-100" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-3/5 rounded bg-ink-100" />
                <div className="h-2.5 w-2/5 rounded bg-ink-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {files && (
        <div>
          <div className="h-4 w-20 rounded bg-ink-100 mb-3" />
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-ink-200 bg-surface overflow-hidden animate-pulse">
                <div className="h-32 bg-ink-100" />
                <div className="p-3 space-y-2">
                  <div className="h-3 w-4/5 rounded bg-ink-100" />
                  <div className="h-2.5 w-2/5 rounded bg-ink-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  dashed,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <div
      className={cn(
        "max-w-lg mx-auto my-6 px-6 py-12 text-center rounded-2xl",
        dashed ? "border-2 border-dashed border-ink-200" : "bg-surface border border-ink-200"
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-ink-100 text-ink-600 flex items-center justify-center mx-auto mb-4">{icon}</div>
      <h3 className="text-base font-bold text-ink-900">{title}</h3>
      {description && <p className="text-sm text-ink-500 mt-1.5 leading-relaxed max-w-sm mx-auto">{description}</p>}
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState icon={<AlertTriangle className="w-6 h-6 text-danger-600" />} title="Isi folder tidak dapat dimuat" description={message}>
      <Button variant="secondary" size="md" icon={<RotateCw className="w-4 h-4" />} onClick={onRetry}>
        Coba lagi
      </Button>
    </EmptyState>
  );
}

/** Infinite-scroll sentinel plus a manual button for keyboard and slow connections. */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  shown,
  total,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onLoadMore);
  cb.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && cb.current(), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading]);

  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} className="flex flex-col items-center gap-1.5 pt-6 pb-2">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Memuat item berikutnya
        </div>
      ) : (
        <Button variant="secondary" onClick={onLoadMore}>
          Muat lebih banyak
        </Button>
      )}
      <span className="text-xs text-ink-500 tabular">
        {shown} dari {total} item
      </span>
    </div>
  );
}

export function DropOverlay({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <div className="absolute inset-2 z-40 rounded-2xl border-2 border-dashed border-accent-600 bg-accent-50/80 flex items-center justify-center pointer-events-none animate-fade-in">
      <div className="flex flex-col items-center gap-2 text-center px-6">
        <UploadCloud className="w-8 h-8 text-ink-700" />
        <span className="text-sm font-semibold text-ink-900">{label}</span>
        {disabled && <span className="text-xs text-ink-500">Unggahan tidak diizinkan di sini</span>}
      </div>
    </div>
  );
}

export { FolderGlyph, IconButton };
