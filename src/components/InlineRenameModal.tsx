import React, { useState, useEffect, useRef } from "react";
import { Folder, FileItem } from "../types/frontend.ts";
import { Edit2, X, Check, Loader2 } from "lucide-react";

interface InlineRenameModalProps {
  item: { type: "folder"; data: Folder } | { type: "file"; data: FileItem };
  onClose: () => void;
  onSave: (newName: string) => Promise<void>;
}

export const InlineRenameModal: React.FC<InlineRenameModalProps> = ({
  item,
  onClose,
  onSave,
}) => {
  const initialName = item.type === "folder" ? item.data.name : item.data.originalName;
  const [name, setName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Select text without extension if file
      if (item.type === "file") {
        const lastDot = initialName.lastIndexOf(".");
        if (lastDot > 0) {
          inputRef.current.setSelectionRange(0, lastDot);
        } else {
          inputRef.current.select();
        }
      } else {
        inputRef.current.select();
      }
    }
  }, [initialName, item.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError("Nama tidak boleh kosong");
      return;
    }
    if (clean === initialName) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave(clean);
      onClose();
    } catch (err: any) {
      setError(err.message || "Gagal mengubah nama");
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-slate-900 animate-scale-in">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Edit2 className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-slate-900">
              Ubah Nama {item.type === "folder" ? "Folder" : "Berkas"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Nama Baru:
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSaving}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder="Masukkan nama baru..."
            />
            {error && <p className="text-xs text-rose-600 font-semibold mt-1.5">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Simpan Perubahan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
