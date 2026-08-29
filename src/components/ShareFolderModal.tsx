import React, { useState, useEffect } from "react";
import { 
  Share2, X, Eye, Edit3, Link as LinkIcon, Copy, Check, 
  ShieldCheck, KeyRound, Loader2, CheckCircle2, Lock, Unlock, Mail, EyeOff 
} from "lucide-react";
import { Folder, FolderPermission, FileItem } from "../types/frontend";
import { api } from "../services/api";

interface ShareFolderModalProps {
  folder?: Folder | null;
  file?: FileItem | null;
  onClose: () => void;
  onPermissionUpdated?: (updatedFolder: Folder) => void;
}

// Client-side SHA-256 helper for password hashing
async function sha256(message: string): Promise<string> {
  if (!message) return "";
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ShareFolderModal: React.FC<ShareFolderModalProps> = ({
  folder,
  file,
  onClose,
  onPermissionUpdated,
}) => {
  const isFile = !!file;
  const item = file || folder;

  if (!item) return null;

  const [copiedType, setCopiedType] = useState<"view" | "edit" | null>(null);
  const [currentBasePerm, setCurrentBasePerm] = useState<FolderPermission>(
    folder?.permission || FolderPermission.VIEW
  );
  const [isUpdatingBasePerm, setIsUpdatingBasePerm] = useState(false);
  const [permUpdateMessage, setPermUpdateMessage] = useState<string | null>(null);

  // Security restrictions states
  const [isPasswordEnabled, setIsPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [showPasswordText, setShowPasswordText] = useState(false);

  const [isEmailRestrictionEnabled, setIsEmailRestrictionEnabled] = useState(false);
  const [emails, setEmails] = useState("");

  const [isLoadingLinks, setIsLoadingLinks] = useState(true);
  const [shareData, setShareData] = useState<{
    viewLink: { permission: string; signature: string; url: string; name: string; description: string };
    editLink?: { permission: string; signature: string; url: string; name: string; description: string };
  } | null>(null);

  const fetchLinks = async () => {
    setIsLoadingLinks(true);
    try {
      const pwdHash = isPasswordEnabled && password ? await sha256(password) : undefined;
      const emailsList = isEmailRestrictionEnabled && emails ? emails : undefined;

      const origin = window.location.origin + window.location.pathname;

      if (isFile && file) {
        const res = await api.getFileShareLinks(file.id, pwdHash, emailsList);
        if (res.links) {
          let suffix = "";
          if (pwdHash) suffix += `&pwdHash=${encodeURIComponent(pwdHash)}`;
          if (emailsList) suffix += `&emails=${encodeURIComponent(emailsList)}`;

          setShareData({
            viewLink: {
              ...res.links.viewLink,
              url: `${origin}?fileId=${encodeURIComponent(file.id)}&perm=VIEW&sig=${res.links.viewLink.signature}${suffix}`,
            },
          });
        }
      } else if (folder) {
        const res = await api.getFolderShareLinks(folder.id, pwdHash, emailsList);
        if (res.links) {
          let suffix = "";
          if (pwdHash) suffix += `&pwdHash=${encodeURIComponent(pwdHash)}`;
          if (emailsList) suffix += `&emails=${encodeURIComponent(emailsList)}`;

          setShareData({
            viewLink: {
              ...res.links.viewLink,
              url: `${origin}?folderId=${encodeURIComponent(folder.id)}&perm=VIEW&sig=${res.links.viewLink.signature}${suffix}`,
            },
            editLink: {
              ...res.links.editLink,
              url: `${origin}?folderId=${encodeURIComponent(folder.id)}&perm=EDIT&sig=${res.links.editLink.signature}${suffix}`,
            },
          });
        }
      }
    } catch (err) {
      console.error("Failed to load share links:", err);
    } finally {
      setIsLoadingLinks(false);
    }
  };

  // Load server-generated cryptographic signed links
  useEffect(() => {
    fetchLinks();
  }, [isFile ? file?.id : folder?.id]);

  const handleCopy = async (url: string, type: "view" | "edit") => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 3000);
    } catch {
      const el = document.getElementById(`input-share-${type}`) as HTMLInputElement;
      if (el) {
        el.select();
        document.execCommand("copy");
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 3000);
      }
    }
  };

  const handleUpdateBasePermission = async (newPerm: FolderPermission) => {
    if (newPerm === currentBasePerm || isFile || !folder) return;
    setIsUpdatingBasePerm(true);
    setPermUpdateMessage(null);
    try {
      const res = await api.updateFolder(folder.id, { permission: newPerm });
      setCurrentBasePerm(newPerm);
      setPermUpdateMessage("Izin standar folder berhasil diperbarui!");
      onPermissionUpdated?.(res.folder);
      setTimeout(() => setPermUpdateMessage(null), 4000);
    } catch (err: any) {
      setPermUpdateMessage(`Gagal memperbarui izin: ${err.message}`);
    } finally {
      setIsUpdatingBasePerm(false);
    }
  };

  const handleApplySecuritySettings = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLinks();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 text-slate-900 max-h-[90vh] overflow-y-auto">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">
                {isFile ? "Bagikan Berkas via Tautan" : "Bagikan Folder & Kelola Izin Akses"}
              </h3>
              <p className="text-xs text-slate-500 truncate max-w-[280px] sm:max-w-md">
                {isFile ? "Berkas: " : "Folder: "} 
                <strong className="text-slate-800 font-semibold">"{item.name}"</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Feature Banner */}
        <div className="mb-5 p-3 rounded-xl bg-slate-900 text-white flex items-start gap-3 shadow-xs">
          <KeyRound className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold text-slate-100 flex items-center gap-1.5">
              <span>Keamanan Kriptografi HMAC (Anti-Manipulasi URL)</span>
              <span className="px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 text-[10px] font-mono">
                SHA-256 SIGNED
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Setiap tautan memiliki tanda tangan digital terenkripsi yang unik.
              Pengguna tidak dapat mengakses dokumen atau folder yang dilindungi jika tautan diubah secara ilegal.
            </p>
          </div>
        </div>

        {/* SECURITY SETTINGS FORM */}
        <form onSubmit={handleApplySecuritySettings} className="mb-5 p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-4">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-blue-600" />
            <span>Pengaturan Keamanan Tautan</span>
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Password Toggle & Input */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPasswordEnabled}
                  onChange={(e) => {
                    setIsPasswordEnabled(e.target.checked);
                    if (!e.target.checked) setPassword("");
                  }}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <span>Proteksi Kata Sandi</span>
              </label>
              {isPasswordEnabled && (
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-slate-400">
                    <KeyRound className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type={showPasswordText ? "text" : "password"}
                    placeholder="Masukkan kata sandi..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-8 pr-8 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPasswordText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>

            {/* Email Restrictions Toggle & Input */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEmailRestrictionEnabled}
                  onChange={(e) => {
                    setIsEmailRestrictionEnabled(e.target.checked);
                    if (!e.target.checked) setEmails("");
                  }}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <span>Batasi Email Penerima</span>
              </label>
              {isEmailRestrictionEnabled && (
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-slate-400">
                    <Mail className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    placeholder="Contoh: user1@email.com, user2@email.com"
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    required
                    className="w-full pl-8 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Terapkan Keamanan &amp; Perbarui Tautan</span>
            </button>
          </div>
        </form>

        {/* GENERATED LINKS DISPLAY */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Tautan Bagikan Berkas / Folder:
            </label>
            <span className="text-[11px] text-slate-500 font-medium">
              Tanda Tangan Kriptografi Aktif
            </span>
          </div>

          {isLoadingLinks ? (
            <div className="py-8 text-center space-y-2 bg-slate-50 rounded-2xl border border-slate-200">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto" />
              <p className="text-xs text-slate-500">Menghasilkan tanda tangan kriptografi tautan...</p>
            </div>
          ) : shareData ? (
            <div className="space-y-3.5">
              
              {/* LINK 1: HANYA LIHAT (VIEW ONLY) */}
              <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 hover:bg-amber-50/60 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                      <Eye className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="font-bold text-xs text-amber-950 flex items-center gap-1.5">
                        <span>{isFile ? 'Tautan Khusus Pratinjau Berkas (VIEW)' : '1. Tautan Khusus "Hanya Lihat" (VIEW)'}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-200/80 text-amber-900 border border-amber-300">
                          Hanya Baca / Unduh
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-amber-900/80 mb-2.5">
                  {isFile 
                    ? "Penerima tautan ini dapat melihat pratinjau langsung secara instan dan mengunduh berkas ini."
                    : "Penerima tautan ini hanya dapat melihat pratinjau dan mengunduh berkas. Tindakan mengunggah, menghapus, atau mengubah nama dikunci."
                  }
                </p>

                {/* Input with Copy Button */}
                <div className="flex items-center gap-2 p-1.5 bg-white rounded-xl border border-amber-200 shadow-2xs">
                  <LinkIcon className="w-3.5 h-3.5 text-amber-500 shrink-0 ml-1.5" />
                  <input
                    id="input-share-view"
                    type="text"
                    readOnly
                    value={shareData.viewLink.url}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="w-full bg-transparent text-xs text-slate-800 font-mono focus:outline-none select-all truncate"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(shareData.viewLink.url, "view")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 active:scale-95 ${
                      copiedType === "view"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-amber-600 hover:bg-amber-500 text-white shadow-xs"
                    }`}
                  >
                    {copiedType === "view" ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Tersalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Salin Tautan</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* LINK 2: BISA MENGEDIT (EDIT ALLOWED) - Only for Folders */}
              {!isFile && shareData.editLink && (
                <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/60 transition-colors">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                        <Edit3 className="w-4 h-4" />
                      </span>
                      <div>
                        <div className="font-bold text-xs text-emerald-950 flex items-center gap-1.5">
                          <span>2. Tautan Khusus "Bisa Mengedit" (EDIT)</span>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-200/80 text-emerald-900 border border-emerald-300">
                            Akses Penuh
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-emerald-900/80 mb-2.5">
                    Penerima tautan ini <strong>diizinkan mengunggah dokumen baru, mengubah nama berkas, dan mengelola konten</strong> di dalam folder ini.
                  </p>

                  {/* Input with Copy Button */}
                  <div className="flex items-center gap-2 p-1.5 bg-white rounded-xl border border-emerald-200 shadow-2xs">
                    <LinkIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0 ml-1.5" />
                    <input
                      id="input-share-edit"
                      type="text"
                      readOnly
                      value={shareData.editLink.url}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="w-full bg-transparent text-xs text-slate-800 font-mono focus:outline-none select-all truncate"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(shareData.editLink.url, "edit")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 active:scale-95 ${
                        copiedType === "edit"
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-emerald-600 hover:bg-emerald-505 text-white shadow-xs"
                      }`}
                    >
                      {copiedType === "edit" ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Tersalin!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Salin Tautan Edit</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

            </div>
          ) : null}

          {/* FOLDER BASE PERMISSION INTEGRATION - Only for Folders */}
          {!isFile && folder && (
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Izin Standar Folder Aplikasi:
              </label>
              <p className="text-[11px] text-slate-500 mb-3">
                Menentukan izin default saat folder diakses melalui navigasi umum (tanpa tautan ber-token):
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isUpdatingBasePerm}
                  onClick={() => handleUpdateBasePermission(FolderPermission.EDIT)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    currentBasePerm === FolderPermission.EDIT
                      ? "border-emerald-500 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-500/20 font-bold"
                      : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs mb-0.5">
                    <Edit3 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Standar: Bisa Mengedit</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-normal">
                    Semua staf terautentikasi dapat mengunggah
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isUpdatingBasePerm}
                  onClick={() => handleUpdateBasePermission(FolderPermission.VIEW)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    currentBasePerm === FolderPermission.VIEW
                      ? "border-amber-500 bg-amber-50 text-amber-950 ring-2 ring-amber-500/20 font-bold"
                      : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs mb-0.5">
                    <Eye className="w-3.5 h-3.5 text-amber-600" />
                    <span>Standar: Hanya Lihat</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-normal">
                    Hanya pemilik &amp; admin yang dapat mengunggah
                  </span>
                </button>
              </div>

              {permUpdateMessage && (
                <p className="text-xs font-semibold text-emerald-600 mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {permUpdateMessage}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Tanda tangan kriptografi aktif &amp; tervalidasi</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
};
