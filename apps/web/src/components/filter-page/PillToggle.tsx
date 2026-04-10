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
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
        selected
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
