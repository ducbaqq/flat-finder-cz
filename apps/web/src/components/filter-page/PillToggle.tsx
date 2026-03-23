"use client";

import { cn } from "@/lib/cn";

interface PillToggleProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  className?: string;
}

export function PillToggle({
  label,
  selected,
  onClick,
  icon,
  className,
}: PillToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
        selected
          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90"
          : "bg-muted text-foreground hover:bg-muted/70",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
