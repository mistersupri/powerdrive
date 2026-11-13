import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-lg bg-primary text-white", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M4 16.5V8.5l8-4 8 4v8l-8 4z" /><path d="M4 8.5l8 4 8-4M12 12.5v8" /></svg>
    </span>
  );
}
export function Logo({ className }: { className?: string }) {
  return <div className={cn("flex items-center gap-2.5", className)}><LogoMark /><span className="text-[18px] font-bold tracking-tight">SuperDrive</span></div>;
}
