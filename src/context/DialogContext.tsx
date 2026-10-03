import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../ui/Dialog.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../lib/cn.ts";

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
  leaving?: boolean;
}

interface DialogContextType {
  showAlert: (options: AlertOptions | string) => Promise<void>;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
  showToast: (message: string, type?: DialogType) => void;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

const defaultTitles: Record<DialogType, string> = {
  error: "Terjadi kesalahan",
  warning: "Perhatian",
  success: "Berhasil",
  info: "Informasi",
};

const tone: Record<DialogType, { icon: React.ReactNode; chip: string }> = {
  error: { icon: <AlertCircle className="w-5 h-5" />, chip: "bg-danger-50 text-danger-600" },
  warning: { icon: <AlertTriangle className="w-5 h-5" />, chip: "bg-warn-50 text-warn-600" },
  success: { icon: <CheckCircle2 className="w-5 h-5" />, chip: "bg-ok-50 text-ok-600" },
  info: { icon: <Info className="w-5 h-5" />, chip: "bg-ink-100 text-ink-700" },
};

const TOAST_MS = 4000;

export const DialogProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<{
    title: string;
    message: string;
    type: DialogType;
    resolve: () => void;
  } | null>(null);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    isDanger: boolean;
    resolve: (val: boolean) => void;
  } | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const showAlert = useCallback((options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions = typeof options === "string" ? { message: options, type: "info" } : options;
      const type = opts.type || "info";
      setAlertState({ title: opts.title || defaultTitles[type], message: opts.message, type, resolve });
    });
  }, []);

  const closeAlert = () => {
    alertState?.resolve();
    setAlertState(null);
  };

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      const isDanger = options.isDanger ?? true;
      setConfirmState({
        title: options.title || "Lanjutkan tindakan ini?",
        message: options.message,
        confirmText: options.confirmText || (isDanger ? "Hapus" : "Lanjutkan"),
        cancelText: options.cancelText || "Batal",
        isDanger,
        resolve,
      });
    });
  }, []);

  const handleConfirmChoice = (confirmed: boolean) => {
    confirmState?.resolve(confirmed);
    setConfirmState(null);
  };

  const removeToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    // Mark as leaving first so the exit fade can play, then drop it.
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 150);
  }, []);

  const scheduleRemoval = useCallback(
    (id: string, ms = TOAST_MS) => {
      timers.current.set(
        id,
        setTimeout(() => removeToast(id), ms)
      );
    },
    [removeToast]
  );

  const showToast = useCallback(
    (message: string, type: DialogType = "info") => {
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
      scheduleRemoval(id);
    },
    [scheduleRemoval]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ showAlert, showConfirm, showToast }), [showAlert, showConfirm, showToast]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      <Dialog open={!!alertState} onClose={closeAlert} size="sm" zIndex={90}>
        {alertState && (
          <>
            <DialogHeader
              title={alertState.title}
              icon={<span className={cn("w-9 h-9 rounded-xl flex items-center justify-center", tone[alertState.type].chip)}>{tone[alertState.type].icon}</span>}
            />
            <DialogBody>
              <p className="text-sm text-ink-600 leading-relaxed break-words whitespace-pre-wrap">{alertState.message}</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="primary" size="md" onClick={closeAlert} data-autofocus>
                Mengerti
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>

      <Dialog open={!!confirmState} onClose={() => handleConfirmChoice(false)} size="sm" zIndex={90}>
        {confirmState && (
          <>
            <DialogHeader
              title={confirmState.title}
              icon={
                confirmState.isDanger ? (
                  <span className={cn("w-9 h-9 rounded-xl flex items-center justify-center", tone.error.chip)}>{tone.error.icon}</span>
                ) : undefined
              }
            />
            <DialogBody>
              <p className="text-sm text-ink-600 leading-relaxed break-words whitespace-pre-wrap">{confirmState.message}</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" size="md" onClick={() => handleConfirmChoice(false)}>
                {confirmState.cancelText}
              </Button>
              <Button
                variant={confirmState.isDanger ? "danger" : "primary"}
                size="md"
                onClick={() => handleConfirmChoice(true)}
                data-autofocus
              >
                {confirmState.confirmText}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>

      {/* Toasts sit above the mobile bottom nav and pause while hovered. */}
      <div
        aria-live="polite"
        className="fixed z-[100] left-3 right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:left-auto md:right-5 md:bottom-5 md:w-80 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            onMouseEnter={() => {
              const timer = timers.current.get(toast.id);
              if (timer) clearTimeout(timer);
            }}
            onMouseLeave={() => scheduleRemoval(toast.id, 1500)}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 pl-3 pr-1.5 py-2.5 rounded-xl bg-night-900 text-night-50 ring-1 ring-white/10 shadow-float text-sm",
              "transition-opacity duration-150",
              toast.leaving ? "opacity-0" : "animate-slide-up"
            )}
          >
            <span
              className={cn(
                "mt-0.5 shrink-0",
                toast.type === "success" && "text-ok-400",
                toast.type === "error" && "text-danger-400",
                toast.type === "warning" && "text-warn-400",
                toast.type === "info" && "text-night-300"
              )}
            >
              {React.cloneElement(tone[toast.type].icon as React.ReactElement<{ className?: string }>, { className: "w-4 h-4" })}
            </span>
            <span className="flex-1 font-medium leading-snug break-words">{toast.message}</span>
            <button
              type="button"
              aria-label="Tutup notifikasi"
              onClick={() => removeToast(toast.id)}
              className="p-1 rounded-md text-night-400 hover:text-night-50 hover:bg-night-800"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
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
