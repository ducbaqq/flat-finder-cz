"use client";

import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FilterSidebar } from "./FilterSidebar";

interface FilterSheetProps {
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
}

export function FilterSheet({ filters, setFilter }: FilterSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden" data-testid="filter-sheet-trigger">
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Filtry
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl p-0" data-testid="filter-sheet">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Filtry</SheetTitle>
        </SheetHeader>
        <FilterSidebar filters={filters} setFilter={setFilter} />
      </SheetContent>
    </Sheet>
  );
}
