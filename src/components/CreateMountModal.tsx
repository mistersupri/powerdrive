import React, { useState } from "react";
import { HardDrive, Plus, X, Loader2, FolderPlus, Info } from "lucide-react";
import { api } from "../services/api.ts";
import { useDialog } from "../context/DialogContext.tsx";

interface CreateMountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMountCreated: () => void;
}

export const CreateMountModal: React.FC<CreateMountModalProps> = ({
  isOpen,
  onClose,
  onMountCreated,
}) => {
  const { showAlert, showToast } = useDialog();
  const [folderName, setFolderName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = folderName.trim();
    if (!cleanName) {
      showAlert({
        title: "Validasi Gagal",
        message: "Silakan masukkan nama folder mount (misal: usb-storage, data-nas, hdd-eksternal).",
        type: "warning",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.createMountPoint(cleanName);
      showToast(res.message || "Drive mount baru berhasil ditambahkan", "success");
      setFolderName("");
      onMountCreated();
      onClose();
    } catch (err: any) {
      showAlert({
        title: "Gagal Menambahkan Mount",
        message: err.message || "Terjadi kesalahan saat membuat titik pasang direktori /mnt.",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const sampleNames = ["usb-storage", "data-nas", "backup-hdd", "media-storage"];

  return (
    <div
      className="fixed inset-0 z-50 bg-night-950/45 flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface rounded-2xl max-w-md w-full p-6 shadow-float border border-ink-200 text-ink-800 animate-pop-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent-50 border border-accent-100 flex items-center justify-center text-accent-600">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-ink-900 text-base">Tambah Drive Terpasang</h3>
              <p className="text-xs text-ink-500">Buat / Hubungkan folder pada sistem <code className="bg-ink-100 px-1 py-0.5 rounded text-accent-700 font-mono">/mnt</code></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-600 p-1.5 rounded-xl hover:bg-ink-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Box */}
        <div className="mb-5 p-3.5 bg-accent-50/70 border border-accent-100 rounded-2xl flex items-start gap-2.5 text-xs text-accent-800 leading-relaxed">
          <Info className="w-4 h-4 text-accent-600 shrink-0 mt-0.5" />
          <div>
            Setiap folder di dalam direktori <strong className="font-semibold">/mnt</strong> secara otomatis terbaca sebagai drive lokal mandiri di bilah samping.
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-ink-700 mb-1.5">
              Nama Folder Titik Pasang (Mount Point)
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 font-mono text-xs text-ink-400 select-none">
                /mnt/
              </span>
              <input
                type="text"
                placeholder="contoh: data-storage"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "-"))}
                required
                className="w-full pl-16 pr-4 py-2.5 bg-ink-50 border border-ink-200 rounded-xl text-xs font-mono text-ink-900 focus:outline-hidden focus:ring-2 focus:ring-accent-500 focus:bg-surface"
                autoFocus
              />
            </div>
            <p className="text-[11px] text-ink-400 mt-1">
              Gunakan huruf, angka, tanda strip (-), atau garis bawah (_).
            </p>
          </div>

          {/* Quick Suggestions */}
          <div>
            <span className="text-[11px] font-semibold text-ink-500">Saran Cepat:</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {sampleNames.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setFolderName(s)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-ink-100 hover:bg-accent-50 text-ink-600 hover:text-accent-700 border border-ink-200 transition-colors"
                >
                  /mnt/{s}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-ink-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 text-xs font-bold text-accent-fg bg-accent-600 hover:bg-accent-700 rounded-xl shadow-card active:scale-95 transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderPlus className="w-4 h-4" />
              )}
              <span>Pasang Drive</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
