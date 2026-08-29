import React, { useState, useEffect } from "react";
import { MountFileItem } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import {
  X,
  FolderOpen,
  Copy,
  Move,
  Loader2,
  Folder as FolderIcon,
  ChevronRight,
} from "lucide-react";

interface MoveCopyMountModalProps {
  mountId: string;
  items: MountFileItem[];
  mode: "move" | "copy";
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const MoveCopyMountModal: React.FC<MoveCopyMountModalProps> = ({
  mountId,
  items,
  mode,
  onClose,
  onSuccess,
}) => {
  const [currentSubPath, setCurrentSubPath] = useState<string>("");
  const [directories, setDirectories] = useState<MountFileItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ name: string; subPath: string }[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchCurrentDirectory = async (subPath: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.browseMountDirectory(mountId, subPath);
      // Filter items to show directories only
      const dirs = res.items.filter((item) => item.isDirectory);
      setDirectories(dirs);
      setBreadcrumbs(res.breadcrumbs || []);
    } catch (err: any) {
      console.error("Failed to load directories in copy-move modal:", err);
      setErrorMessage("Gagal memuat direktori tujuan.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentDirectory(currentSubPath);
  }, [mountId, currentSubPath]);

  const handleNavigate = (path: string) => {
    setCurrentSubPath(path);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const sourcePaths = items.map((item) => item.relativePath);

    try {
      if (mode === "move") {
        const res = await api.bulkMoveMountItems(mountId, sourcePaths, currentSubPath);
        if (res.success) {
          onSuccess(res.message);
          onClose();
        } else {
          setErrorMessage(res.message || "Gagal memindahkan item.");
        }
      } else {
        const res = await api.bulkCopyMountItems(mountId, sourcePaths, currentSubPath);
        if (res.success) {
          onSuccess(res.message);
          onClose();
        } else {
          setErrorMessage(res.message || "Gagal menyalin item.");
        }
      }
    } catch (err: any) {
      console.error(`Failed to ${mode} items:`, err);
      setErrorMessage(
        err.message || `Terjadi kesalahan saat ${mode === "move" ? "memindahkan" : "menyalin"} item.`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl border border-slate-100 overflow-hidden flex flex-col max-h-[80vh] animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === "move" ? (
              <Move className="w-5 h-5 text-indigo-600" />
            ) : (
              <Copy className="w-5 h-5 text-indigo-600" />
            )}
            <h2 className="text-base font-bold text-slate-800">
              {mode === "move" ? "Pindahkan" : "Salin"} {items.length} Item
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Items Preview */}
        <div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Item yang terpilih:
          </span>
          <div className="text-xs font-semibold text-slate-700 truncate max-w-full">
            {items.length === 1
              ? items[0].name
              : `${items[0].name} dan ${items.length - 1} item lainnya`}
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs text-rose-600 font-medium">
            {errorMessage}
          </div>
        )}

        {/* Directory Breadcrumbs inside Modal */}
        <div className="px-6 py-3 border-b border-slate-100 bg-white flex items-center gap-1.5 overflow-x-auto text-xs shrink-0 scrollbar-none">
          <button
            onClick={() => handleNavigate("")}
            className={`flex items-center gap-1 py-1 px-2 rounded-md hover:bg-slate-100 transition-colors ${
              currentSubPath === "" ? "font-bold text-indigo-600 bg-indigo-50" : "text-slate-600"
            }`}
          >
            Root
          </button>
          {breadcrumbs.slice(1).map((crumb) => (
            <React.Fragment key={crumb.subPath}>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <button
                onClick={() => handleNavigate(crumb.subPath)}
                className={`py-1 px-2 rounded-md hover:bg-slate-100 transition-colors ${
                  currentSubPath === crumb.subPath ? "font-bold text-indigo-600 bg-indigo-50" : "text-slate-600"
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Directory Browser List */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[250px] bg-slate-50/30">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              <span className="text-xs text-slate-500 mt-2">Memuat direktori...</span>
            </div>
          ) : directories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
              <FolderIcon className="w-10 h-10 stroke-1 mb-2 text-slate-300" />
              <span className="text-xs">Tidak ada subfolder di folder ini.</span>
            </div>
          ) : (
            <div className="space-y-1">
              {directories.map((dir) => {
                // Prevent choosing itself or a subfolder if moving
                const isSelfOrDescendant = items.some(
                  (item) =>
                    dir.relativePath === item.relativePath ||
                    dir.relativePath.startsWith(item.relativePath + "/")
                );

                return (
                  <button
                    key={dir.id}
                    disabled={isSelfOrDescendant}
                    onClick={() => handleNavigate(dir.relativePath)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                      isSelfOrDescendant
                        ? "bg-slate-100 border-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-white border-slate-200/60 hover:border-slate-300 hover:bg-slate-50 text-slate-700 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FolderIcon className={`w-4 h-4 shrink-0 ${isSelfOrDescendant ? "text-slate-300" : "text-amber-500"}`} />
                      <span className="text-xs font-semibold truncate">{dir.name}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Tujuan: <span className="font-bold text-slate-700">{currentSubPath || "Root"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              Batal
            </button>
            <button
              disabled={isSubmitting || isLoading}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-55 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : mode === "move" ? (
                <Move className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{mode === "move" ? "Pindahkan" : "Salin"} ke Sini</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
