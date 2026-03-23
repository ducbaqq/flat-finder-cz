"use client";

interface PillRangeInputProps {
  label: string;
  minValue: string;
  maxValue: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  unit: string;
  minPlaceholder?: string;
  maxPlaceholder?: string;
}

export function PillRangeInput({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  unit,
  minPlaceholder = "od",
  maxPlaceholder = "do",
}: PillRangeInputProps) {
  return (
    <div>
      <h3 className="mb-3 text-base font-semibold text-foreground">{label}</h3>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            type="number"
            value={minValue}
            onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className="w-full rounded-full border border-divider bg-card px-4 py-2.5 pr-12 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        </div>
        <span className="flex items-center text-sm text-muted-foreground">&ndash;</span>
        <div className="relative flex-1">
          <input
            type="number"
            value={maxValue}
            onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className="w-full rounded-full border border-divider bg-card px-4 py-2.5 pr-12 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}
