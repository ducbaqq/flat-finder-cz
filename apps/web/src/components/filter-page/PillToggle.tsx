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
          ? "bg-[#CC0000] text-white hover:bg-[#AE0000]"
          : "bg-[#F8F8F8] text-[#232B3A] hover:bg-[#EEEEEE]",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
