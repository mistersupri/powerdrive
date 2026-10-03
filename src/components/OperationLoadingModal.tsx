import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "../ui/Dialog.tsx";

export type OperationType = "trash" | "restore" | "permanent_delete" | "sync" | "default";

export interface OperationLoadingModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  type?: OperationType;
  subMessage?: string;
}

/** Shown before this delay, a blocking card only flashes for operations that finish quickly. */
const SHOW_AFTER_MS = 300;

/** Blocking progress card for operations the user must wait for (move, delete, restore). */
export const OperationLoadingModal: React.FC<OperationLoadingModalProps> = ({ isOpen, title, message, subMessage }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [isOpen]);

  return (
    <Dialog open={visible} onClose={() => undefined} dismissible={false} size="sm" label={title} zIndex={85}>
      <div className="flex items-center gap-4 p-5" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-ink-700 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-ink-900">{title}</div>
          {message && <div className="text-sm text-ink-600 truncate">{message}</div>}
          {subMessage && <div className="text-xs text-ink-500 mt-0.5">{subMessage}</div>}
        </div>
      </div>
      <div className="h-1 bg-ink-100 overflow-hidden">
        <div className="h-full w-2/5 bg-accent-600 animate-progress" />
      </div>
    </Dialog>
  );
};
