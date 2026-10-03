import React, { useId } from "react";
import { cn } from "../lib/cn.ts";

const FieldIdContext = React.createContext<{ id: string; describedBy?: string } | null>(null);

/** Label, control, hint and error in one stack. The label is wired to the first control. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  trailing,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  trailing?: React.ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <FieldIdContext.Provider value={{ id, describedBy }}>
      <div className={cn("space-y-1.5", className)}>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm font-semibold text-ink-800">
            {label}
          </label>
          {trailing ?? (hint && !error && <span id={`${id}-hint`} className="text-xs text-ink-500">{hint}</span>)}
        </div>
        {children}
        {error && (
          <p id={`${id}-err`} role="alert" className="text-xs font-medium text-danger-600">
            {error}
          </p>
        )}
      </div>
    </FieldIdContext.Provider>
  );
}

const control =
  "w-full rounded-lg bg-surface border border-ink-200 text-base sm:text-sm text-ink-900 placeholder:text-ink-400 hover:border-ink-300 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:opacity-60 aria-invalid:border-danger-500";

export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { leading?: React.ReactNode; trailing?: React.ReactNode }
>(function TextInput({ className, leading, trailing, ...rest }, ref) {
  const ctx = React.useContext(FieldIdContext);
  const input = (
    <input
      ref={ref}
      id={rest.id ?? ctx?.id}
      aria-describedby={ctx?.describedBy}
      className={cn(control, "h-10", leading ? "pl-9" : "px-3", trailing ? "pr-10" : "", className)}
      {...rest}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">{leading}</span>}
      {input}
      {trailing && <span className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</span>}
    </div>
  );
});

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    const ctx = React.useContext(FieldIdContext);
    return (
      <textarea
        ref={ref}
        id={rest.id ?? ctx?.id}
        aria-describedby={ctx?.describedBy}
        className={cn(control, "px-3 py-2 resize-y min-h-[4.5rem]", className)}
        {...rest}
      />
    );
  }
);
