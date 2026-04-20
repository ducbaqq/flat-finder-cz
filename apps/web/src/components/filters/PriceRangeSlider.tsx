"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PriceRangeSliderProps {
  minValue: string;
  maxValue: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}

export function PriceRangeSlider({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
}: PriceRangeSliderProps) {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="filter-price-range">
      <div>
        <Label className="text-xs text-muted-foreground">Od (Kč)</Label>
        <Input
          type="number"
          min={0}
          placeholder="Min"
          value={minValue}
          onChange={(e) => onMinChange(e.target.value.replace(/-/g, ""))}
          className="mt-1"
          data-testid="filter-price-min"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Do (Kč)</Label>
        <Input
          type="number"
          min={0}
          placeholder="Max"
          value={maxValue}
          onChange={(e) => onMaxChange(e.target.value.replace(/-/g, ""))}
          className="mt-1"
          data-testid="filter-price-max"
        />
      </div>
    </div>
  );
}
