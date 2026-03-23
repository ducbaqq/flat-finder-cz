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
      <h3 className="mb-3 text-base font-semibold text-[#232B3A]">{label}</h3>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            type="number"
            value={minValue}
            onChange={(e) => onMinChange(e.target.value)}
            placeholder={minPlaceholder}
            className="w-full rounded-full border border-[#E0E0E0] bg-white px-4 py-2.5 pr-12 text-sm text-[#232B3A] outline-none transition-colors placeholder:text-[#626D82] focus:border-[#CC0000]"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[#626D82]">
            {unit}
          </span>
        </div>
        <span className="flex items-center text-sm text-[#626D82]">&ndash;</span>
        <div className="relative flex-1">
          <input
            type="number"
            value={maxValue}
            onChange={(e) => onMaxChange(e.target.value)}
            placeholder={maxPlaceholder}
            className="w-full rounded-full border border-[#E0E0E0] bg-white px-4 py-2.5 pr-12 text-sm text-[#232B3A] outline-none transition-colors placeholder:text-[#626D82] focus:border-[#CC0000]"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[#626D82]">
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}
