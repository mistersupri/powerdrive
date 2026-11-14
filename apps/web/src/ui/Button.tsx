import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const V: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  soft: "bg-primary-soft text-primary-ink hover:brightness-95",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-white hover:brightness-110",
};
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }

export const Button = forwardRef<HTMLButtonElement, Props>(({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...p }, ref) => (
  <button
    ref={ref} type="button" disabled={disabled || loading} aria-busy={loading || undefined}
    className={cn(
      "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,transform,filter] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100",
      size === "sm" ? "h-8 px-3 text-[13px] pointer-coarse:h-11" : "h-9 px-4 text-[13px] pointer-coarse:h-11", V[variant], className,
    )}
    {...p}
  >
    {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
    {children}
  </button>
));

/** Icon-only button. The visible chip is 36px but the touch area stays ≥44px on coarse pointers. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(
  ({ label, active, className, children, ...p }, ref) => (
    <button
      ref={ref} type="button" aria-label={label} title={label}
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-[background-color,transform] duration-150 hover:bg-surface-2 hover:text-ink active:scale-95 disabled:opacity-40",
        "after:absolute after:-inset-1 after:content-[''] pointer-coarse:after:-inset-1.5",
        active && "bg-primary-soft text-primary-ink hover:bg-primary-soft", className,
      )}
      {...p}
    >{children}</button>
  ),
);
