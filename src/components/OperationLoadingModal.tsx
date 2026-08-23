import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, Trash2, RotateCcw, AlertTriangle, FolderSync } from "lucide-react";

export type OperationType = "trash" | "restore" | "permanent_delete" | "sync" | "default";

export interface OperationLoadingModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  type?: OperationType;
  subMessage?: string;
}

export const OperationLoadingModal: React.FC<OperationLoadingModalProps> = ({
  isOpen,
  title,
  message,
  type = "default",
  subMessage = "Mohon tunggu sebentar, operasi sedang diproses...",
}) => {
  const getTheme = () => {
    switch (type) {
      case "trash":
        return {
          badgeBg: "bg-amber-50 text-amber-600 border-amber-200",
          ringColor: "border-amber-500",
          icon: <Trash2 className="w-7 h-7 text-amber-600 animate-pulse" />,
          accentGlow: "bg-amber-400/20",
        };
      case "permanent_delete":
        return {
          badgeBg: "bg-rose-50 text-rose-600 border-rose-200",
          ringColor: "border-rose-500",
          icon: <AlertTriangle className="w-7 h-7 text-rose-600 animate-bounce" />,
          accentGlow: "bg-rose-500/20",
        };
      case "restore":
        return {
          badgeBg: "bg-indigo-50 text-indigo-600 border-indigo-200",
          ringColor: "border-indigo-500",
          icon: <RotateCcw className="w-7 h-7 text-indigo-600 animate-spin-reverse" />,
          accentGlow: "bg-indigo-500/20",
        };
      case "sync":
        return {
          badgeBg: "bg-blue-50 text-blue-600 border-blue-200",
          ringColor: "border-blue-500",
          icon: <FolderSync className="w-7 h-7 text-blue-600 animate-spin" />,
          accentGlow: "bg-blue-500/20",
        };
      default:
        return {
          badgeBg: "bg-blue-50 text-blue-600 border-blue-200",
          ringColor: "border-blue-500",
          icon: <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />,
          accentGlow: "bg-blue-500/20",
        };
    }
  };

  const theme = getTheme();

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          id="operation-loading-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none"
        >
          <motion.div
            id="operation-loading-modal-card"
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden relative"
          >
            {/* Ambient subtle decorative glow */}
            <div
              className={`absolute -top-12 -right-12 w-36 h-36 rounded-full blur-2xl pointer-events-none ${theme.accentGlow}`}
            />
            <div
              className={`absolute -bottom-12 -left-12 w-36 h-36 rounded-full blur-2xl pointer-events-none ${theme.accentGlow}`}
            />

            <div className="relative p-6 sm:p-7 flex flex-col items-center text-center">
              {/* Spinner icon wrapper */}
              <div className="relative mb-5 flex items-center justify-center">
                {/* Rotating outer spinner ring */}
                <div className="w-16 h-16 rounded-full border-3 border-slate-100 border-t-blue-600 animate-spin" />
                {/* Center icon badge */}
                <div
                  className={`absolute inset-1.5 rounded-full flex items-center justify-center border shadow-xs ${theme.badgeBg}`}
                >
                  {theme.icon}
                </div>
              </div>

              {/* Title & Message */}
              <h3 className="text-base font-bold text-slate-800 tracking-tight mb-1.5">
                {title}
              </h3>

              {message && (
                <p className="text-xs font-semibold text-slate-600 max-w-[280px] truncate px-2 py-1 bg-slate-50 border border-slate-200/60 rounded-lg mb-2">
                  {message}
                </p>
              )}

              <p className="text-[11px] text-slate-400 font-medium">
                {subMessage}
              </p>

              {/* Indeterminate progress bar */}
              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-4 relative">
                <motion.div
                  className="bg-linear-to-r from-blue-500 via-indigo-500 to-blue-600 h-full rounded-full absolute"
                  animate={{
                    left: ["-40%", "100%"],
                    width: ["40%", "60%", "40%"],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.4,
                    ease: "easeInOut",
                  }}
                />
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
