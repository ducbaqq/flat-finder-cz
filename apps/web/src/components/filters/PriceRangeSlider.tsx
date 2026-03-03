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
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs text-muted-foreground">Od (Kč)</Label>
        <Input
          type="number"
          placeholder="Min"
          value={minValue}
          onChange={(e) => onMinChange(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Do (Kč)</Label>
        <Input
          type="number"
          placeholder="Max"
          value={maxValue}
          onChange={(e) => onMaxChange(e.target.value)}
          className="mt-1"
        />
      </div>
    </div>
  );
}
