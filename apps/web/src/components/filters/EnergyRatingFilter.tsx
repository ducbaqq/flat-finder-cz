"use client";

import { cn } from "@/lib/cn";

interface EnergyRatingFilterProps {
  value: string;
  onChange: (value: string) => void;
}

const ratings = ["A", "B", "C", "D", "E", "F", "G"];
const ratingColors: Record<string, string> = {
  A: "bg-green-600",
  B: "bg-green-500",
  C: "bg-lime-500",
  D: "bg-yellow-500",
  E: "bg-orange-500",
  F: "bg-red-500",
  G: "bg-red-700",
};

export function EnergyRatingFilter({ value, onChange }: EnergyRatingFilterProps) {
  const selected = value ? value.split(",") : [];

  const toggle = (rating: string) => {
    const next = selected.includes(rating)
      ? selected.filter((r) => r !== rating)
      : [...selected, rating];
    onChange(next.join(","));
  };

  return (
    <div className="flex gap-1">
      {ratings.map((r) => (
        <button
          key={r}
          onClick={() => toggle(r)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold transition-all",
            selected.includes(r)
              ? `${ratingColors[r]} text-white shadow-sm`
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
