import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  Loader2,
  HelpCircle,
} from "lucide-react";

export type DialogType = "info" | "success" | "warning" | "error";

export interface AlertOptions {
  title?: string;
  message: string;
  type?: DialogType;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export interface ToastItem {
  id: string;
  message: string;
  type: DialogType;
}

interface DialogContextType {
  showAlert: (options: AlertOptions | string) => Promise<void>;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
  showToast: (message: string, type?: DialogType) => void;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export const DialogProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Alert State
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: DialogType;
    resolve?: () => void;
  } | null>(null);

  // Confirm State
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    isDanger: boolean;
    resolve?: (val: boolean) => void;
  } | null>(null);

  // Toast State
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showAlert = useCallback((options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions =
        typeof options === "string" ? { message: options, type: "info" } : options;

      setAlertState({
        isOpen: true,
        title: opts.title || (opts.type === "error" ? "Terjadi Kesalahan" : opts.type === "warning" ? "Peringatan" : opts.type === "success" ? "Berhasil" : "Informasi"),
        message: opts.message,
        type: opts.type || "info",
        resolve,
      });
    });
  }, []);

  const closeAlert = () => {
    if (alertState?.resolve) {
      alertState.resolve();
    }
    setAlertState(null);
  };

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title: options.title || "Konfirmasi Tindakan",
        message: options.message,
        confirmText: options.confirmText || (options.isDanger ? "Ya, Hapus" : "Ya, Lanjutkan"),
        cancelText: options.cancelText || "Batal",
        isDanger: options.isDanger ?? true,
        resolve,
      });
    });
  }, []);

  const handleConfirmChoice = (confirmed: boolean) => {
    if (confirmState?.resolve) {
      confirmState.resolve(confirmed);
    }
    setConfirmState(null);
  };

  const showToast = useCallback((message: string, type: DialogType = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <DialogContext.Provider value={{ showAlert, showConfirm, showToast }}>
      {children}

      {/* 1. ALERT POPUP MODAL */}
      {alertState?.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  alertState.type === "error"
                    ? "bg-rose-50 text-rose-600 border border-rose-100"
                    : alertState.type === "warning"
                    ? "bg-amber-50 text-amber-600 border border-amber-100"
                    : alertState.type === "success"
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    : "bg-blue-50 text-blue-600 border border-blue-100"
                }`}
              >
                {alertState.type === "error" ? (
                  <AlertCircle className="w-5 h-5" />
                ) : alertState.type === "warning" ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : alertState.type === "success" ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <Info className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-900 leading-tight">
                  {alertState.title}
                </h4>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed break-words whitespace-pre-wrap">
                  {alertState.message}
                </p>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={closeAlert}
                autoFocus
                className={`px-4 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition-all active:scale-95 ${
                  alertState.type === "error"
                    ? "bg-rose-600 hover:bg-rose-500 shadow-rose-500/20"
                    : alertState.type === "warning"
                    ? "bg-amber-600 hover:bg-amber-500 shadow-amber-500/20"
                    : alertState.type === "success"
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                    : "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20"
                }`}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CONFIRMATION DIALOG MODAL */}
      {confirmState?.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmState.isDanger
                    ? "bg-rose-50 text-rose-600 border border-rose-100"
                    : "bg-blue-50 text-blue-600 border border-blue-100"
                }`}
              >
                {confirmState.isDanger ? (
                  <AlertCircle className="w-5 h-5" />
                ) : (
                  <HelpCircle className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-900 leading-tight">
                  {confirmState.title}
                </h4>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed break-words whitespace-pre-wrap">
                  {confirmState.message}
                </p>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end items-center gap-2">
              <button
                type="button"
                onClick={() => handleConfirmChoice(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
              >
                {confirmState.cancelText}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmChoice(true)}
                autoFocus
                className={`px-4 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition-all active:scale-95 ${
                  confirmState.isDanger
                    ? "bg-rose-600 hover:bg-rose-500 shadow-rose-500/20"
                    : "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20"
                }`}
              >
                {confirmState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. TOAST NOTIFICATIONS */}
      {toasts.length > 0 && (
        <div className="fixed bottom-5 right-5 z-[99999] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto p-3.5 rounded-xl shadow-xl border text-xs flex items-center justify-between gap-3 animate-slide-up ${
                toast.type === "success"
                  ? "bg-emerald-900 text-emerald-100 border-emerald-800"
                  : toast.type === "error"
                  ? "bg-rose-900 text-rose-100 border-rose-800"
                  : toast.type === "warning"
                  ? "bg-amber-900 text-amber-100 border-amber-800"
                  : "bg-slate-900 text-slate-100 border-slate-800"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {toast.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : toast.type === "error" ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : toast.type === "warning" ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 text-blue-400 shrink-0" />
                )}
                <span className="font-medium leading-snug">{toast.message}</span>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="opacity-70 hover:opacity-100 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </DialogContext.Provider>
  );
};

export function useDialog(): DialogContextType {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return context;
}
