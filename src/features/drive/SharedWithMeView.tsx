import React from "react";
import { Users } from "lucide-react";
import { Folder } from "../../types/frontend.ts";
import { FolderGlyph } from "../../ui/FileTypeIcon.tsx";
import { PermissionBadge } from "../../ui/Badge.tsx";
import { EmptyState } from "../explorer/ExplorerParts.tsx";

/** Folders owned by other people that this account can open. */
export function SharedWithMeView({ folders, onOpen }: { folders: Folder[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 pt-5 pb-28 md:pb-10">
      <h1 className="text-xl font-bold text-ink-900">Dibagikan kepada saya</h1>
      <p className="text-sm text-ink-500 mt-1 mb-6">Folder milik pengguna lain yang bisa Anda buka.</p>
      {folders.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="Belum ada folder yang dibagikan"
          description="Folder milik pengguna lain akan muncul di sini setelah mereka memberi Anda akses."
        />
      ) : (
        <ul className="grid gap-3 grid-cols-1 min-[440px]:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onOpen(f.id)}
                className="pressable w-full text-left flex items-start gap-3 p-3.5 rounded-xl border border-ink-200 bg-surface hover:border-ink-300 hover:bg-ink-50"
              >
                <FolderGlyph className="w-6 h-6 mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-900 truncate">{f.name}</span>
                  <span className="block text-xs text-ink-500 truncate mt-0.5">
                    {f.ownerName || "Pengguna lain"} · {f.filesCount || 0} berkas
                  </span>
                  <span className="block mt-2">
                    <PermissionBadge permission={f.permission} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
