export type EntryKind = "folder" | "file";

/** Minimal shape every explorer (My Drive, mounts, public share) maps its rows to. */
export interface ExplorerEntry {
  key: string;
  kind: EntryKind;
  id: string;
  name: string;
}

export const entryKey = (kind: EntryKind, id: string) => `${kind}_${id}`;

export function isCoarsePointer() {
  return typeof window !== "undefined" && (window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches);
}

export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function hasOpenDialog() {
  return !!document.querySelector('[aria-modal="true"], [role="menu"]');
}
