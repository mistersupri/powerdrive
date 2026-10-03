import React from "react";
import { cn } from "../lib/cn.ts";

/**
 * Product name set in the brand typeface. Stands in for a logo until a real
 * one is supplied (see DESIGN.md); no symbol is invented here.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-extrabold tracking-[-0.02em] text-ink-900 whitespace-nowrap", className)}>
      Power<span className="text-ink-500">Drive</span>
    </span>
  );
}
