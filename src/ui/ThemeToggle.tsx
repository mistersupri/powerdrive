import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext.tsx";
import { IconButton } from "./Button.tsx";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const next = resolved === "dark" ? "terang" : "gelap";
  return (
    <IconButton label={`Ganti ke tema ${next}`} onClick={toggle} className={className}>
      {resolved === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
    </IconButton>
  );
}
