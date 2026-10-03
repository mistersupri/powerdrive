import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn.ts";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent-600 text-accent-fg hover:bg-accent-500 shadow-card",
  secondary: "bg-surface text-ink-800 border border-ink-200 hover:bg-ink-50 hover:border-ink-300 shadow-card",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-danger-600 text-white hover:bg-danger-500 shadow-card",
  success: "bg-ok-600 text-white hover:bg-ok-500 shadow-card",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", icon, loading, className, children, disabled, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "pressable inline-flex items-center justify-center font-semibold whitespace-nowrap select-none disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
}

/** Square icon-only button. `label` is required so screen readers and tooltips name it. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", className, children, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "pressable inline-flex items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40 disabled:cursor-not-allowed shrink-0",
        size === "sm" ? "w-8 h-8" : "w-10 h-10",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
