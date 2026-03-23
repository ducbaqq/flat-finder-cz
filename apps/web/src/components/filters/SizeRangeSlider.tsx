"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SizeRangeSliderProps {
  minValue: string;
  maxValue: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}

export function SizeRangeSlider({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
}: SizeRangeSliderProps) {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="filter-size-range">
      <div>
        <Label className="text-xs text-muted-foreground">Od (m²)</Label>
        <Input
          type="number"
          placeholder="Min"
          value={minValue}
          onChange={(e) => onMinChange(e.target.value)}
          className="mt-1"
          data-testid="filter-size-min"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Do (m²)</Label>
        <Input
          type="number"
          placeholder="Max"
          value={maxValue}
          onChange={(e) => onMaxChange(e.target.value)}
          className="mt-1"
          data-testid="filter-size-max"
        />
      </div>
    </div>
  );
}
