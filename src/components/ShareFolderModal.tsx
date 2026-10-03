import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, Link as LinkIcon, Share2, Upload } from "lucide-react";
import { FileItem, Folder, FolderPermission } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../ui/Dialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, TextInput } from "../ui/Field.tsx";
import { cn } from "../lib/cn.ts";

interface ShareFolderModalProps {
  folder?: Folder | null;
  file?: FileItem | null;
  onClose: () => void;
  onPermissionUpdated?: (updatedFolder: Folder) => void;
}

async function sha256(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface ShareLink {
  url: string;
}

function LinkRow({ icon, title, description, link }: { icon: React.ReactNode; title: string; description: string; link?: ShareLink }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      // Clipboard API unavailable (insecure context): the field is selectable instead.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-ink-200 p-3.5">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-ink-100 text-ink-700 flex items-center justify-center shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-900">{title}</div>
          <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <LinkIcon className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            readOnly
            aria-label={`Tautan: ${title}`}
            value={link?.url || "Membuat tautan…"}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full h-9 pl-8 pr-2 rounded-lg bg-ink-50 border border-ink-200 text-xs font-mono text-ink-700 truncate focus:outline-none focus:border-accent-600"
          />
        </div>
        <Button variant="primary" onClick={copy} disabled={!link} icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
          {copied ? "Tersalin" : "Salin"}
        </Button>
      </div>
    </div>
  );
}

export const ShareFolderModal: React.FC<ShareFolderModalProps> = ({ folder, file, onClose, onPermissionUpdated }) => {
  const isFile = !!file;
  const itemId = file?.id || folder?.id || "";
  const itemName = file ? file.originalName : folder?.name || "";

  const [links, setLinks] = useState<{ view?: ShareLink; edit?: ShareLink }>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restrict, setRestrict] = useState(false);
  const [password, setPassword] = useState("");
  const [emails, setEmails] = useState("");
  const [applying, setApplying] = useState(false);
  const [basePerm, setBasePerm] = useState<FolderPermission>(folder?.permission || FolderPermission.VIEW);
  const [permStatus, setPermStatus] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const fetchLinks = useCallback(
    async (pwd?: string, emailList?: string) => {
      setLoadError(null);
      try {
        const pwdHash = pwd ? await sha256(pwd) : undefined;
        const emailsParam = emailList?.trim() || undefined;
        const base = window.location.origin + window.location.pathname;
        let suffix = "";
        if (pwdHash) suffix += `&pwdHash=${encodeURIComponent(pwdHash)}`;
        if (emailsParam) suffix += `&emails=${encodeURIComponent(emailsParam)}`;

        if (isFile) {
          const res = await api.getFileShareLinks(itemId, pwdHash, emailsParam);
          setLinks({ view: { url: `${base}?fileId=${encodeURIComponent(itemId)}&perm=VIEW&sig=${res.links.viewLink.signature}${suffix}` } });
        } else {
          const res = await api.getFolderShareLinks(itemId, pwdHash, emailsParam);
          setLinks({
            view: { url: `${base}?folderId=${encodeURIComponent(itemId)}&perm=VIEW&sig=${res.links.viewLink.signature}${suffix}` },
            edit: res.links.editLink
              ? { url: `${base}?folderId=${encodeURIComponent(itemId)}&perm=EDIT&sig=${res.links.editLink.signature}${suffix}` }
              : undefined,
          });
        }
      } catch (err: any) {
        setLoadError(err?.message || "Tautan tidak dapat dibuat.");
      }
    },
    [isFile, itemId]
  );

  useEffect(() => {
    if (itemId) fetchLinks();
  }, [itemId, fetchLinks]);

  const applyRestrictions = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplying(true);
    setLinks({});
    await fetchLinks(restrict ? password : undefined, restrict ? emails : undefined);
    setApplying(false);
  };

  const changeBasePermission = async (next: FolderPermission) => {
    if (!folder || next === basePerm) return;
    setPermStatus({ busy: true });
    try {
      const res = await api.updateFolder(folder.id, { permission: next });
      setBasePerm(next);
      setPermStatus({ busy: false });
      onPermissionUpdated?.(res.folder);
    } catch (err: any) {
      setPermStatus({ busy: false, error: err?.message || "Izin gagal diubah." });
    }
  };

  if (!itemId) return null;

  return (
    <Dialog open onClose={onClose} size="md">
      <DialogHeader
        icon={<Share2 className="w-4 h-4" />}
        title={isFile ? "Bagikan berkas" : "Bagikan folder"}
        description={<span className="break-all">{itemName}</span>}
        onClose={onClose}
      />
      <DialogBody className="space-y-3 pb-2">
        {loadError ? (
          <p role="alert" className="text-sm text-danger-700 bg-danger-50 rounded-lg px-3 py-2">
            {loadError}
          </p>
        ) : (
          <>
            <LinkRow
              icon={<Eye className="w-4 h-4" />}
              title="Bisa melihat"
              description={isFile ? "Penerima bisa melihat pratinjau dan mengunduh berkas ini." : "Penerima bisa melihat dan mengunduh isi folder, tanpa bisa mengubahnya."}
              link={links.view}
            />
            {!isFile && (
              <LinkRow
                icon={<Upload className="w-4 h-4" />}
                title="Bisa mengunggah"
                description="Penerima juga bisa mengunggah berkas ke folder ini. Bagikan hanya ke orang yang Anda percaya."
                link={links.edit}
              />
            )}
          </>
        )}

        <form onSubmit={applyRestrictions} className="rounded-xl border border-ink-200 p-3.5">
          <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-900">
            <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} className="w-4 h-4 rounded" />
            Minta kata sandi atau email sebelum dibuka
          </label>
          {restrict && (
            <div className="mt-3 space-y-3">
              <Field label="Kata sandi" hint="Opsional">
                <TextInput type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Email yang diizinkan" hint="Pisahkan dengan koma">
                <TextInput value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="nama@contoh.id, staf@contoh.id" />
              </Field>
              <p className="text-xs text-ink-500 leading-relaxed">
                Ini hanya pengingat bagi penerima, bukan pengaman: siapa pun yang memegang tautan lengkap tetap bisa membukanya.
              </p>
              <Button type="submit" loading={applying}>
                Buat tautan baru
              </Button>
            </div>
          )}
        </form>

        {!isFile && folder && (
          <div className="pt-2">
            <div className="text-sm font-semibold text-ink-900">Akses standar folder</div>
            <p className="text-xs text-ink-500 mt-0.5 mb-2.5">Berlaku saat folder dibuka tanpa tautan khusus.</p>
            <div role="radiogroup" aria-label="Akses standar folder" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ink-100">
              {[
                { value: FolderPermission.VIEW, label: "Hanya lihat" },
                { value: FolderPermission.EDIT, label: "Bisa mengunggah" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={basePerm === opt.value}
                  disabled={permStatus.busy}
                  onClick={() => changeBasePermission(opt.value)}
                  className={cn(
                    "h-9 rounded-lg text-sm font-semibold transition-colors",
                    basePerm === opt.value ? "bg-surface text-ink-900 shadow-card" : "text-ink-500 hover:text-ink-900"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {permStatus.error && <p className="text-xs text-danger-600 mt-2">{permStatus.error}</p>}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size="md" onClick={onClose}>
          Selesai
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
