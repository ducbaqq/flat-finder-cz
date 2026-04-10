"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TransactionToggle } from "@/components/filters/TransactionToggle";
import { PropertyTypeFilter } from "@/components/filters/PropertyTypeFilter";
import { LocationAutocomplete } from "@/components/filters/LocationAutocomplete";
import { PriceRangeSlider } from "@/components/filters/PriceRangeSlider";
import { SizeRangeSlider } from "@/components/filters/SizeRangeSlider";
import { LayoutFilter } from "@/components/filters/LayoutFilter";
import { CheckboxGroupFilter } from "@/components/filters/CheckboxGroupFilter";
import { EnergyRatingFilter } from "@/components/filters/EnergyRatingFilter";
import { SourceFilter } from "@/components/filters/SourceFilter";
import {
  conditionLabels,
  constructionLabels,
  ownershipLabels,
  furnishingLabels,
  amenityLabels,
} from "@/lib/utils";

interface FilterSidebarProps {
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
}

export function FilterSidebar({ filters, setFilter }: FilterSidebarProps) {
  return (
    <ScrollArea className="h-[calc(100vh-56px)]" data-testid="filter-sidebar">
      <div className="space-y-5 p-4">
        <TransactionToggle
          value={filters.transaction_type}
          onChange={(v) => setFilter("transaction_type", v)}
        />

        <Separator className="bg-divider" />

        <div data-testid="filter-location-group">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lokalita
          </label>
          <LocationAutocomplete
            value={filters.location}
            onChange={(v) => setFilter("location", v)}
          />
        </div>

        <Separator className="bg-divider" />

        <div data-testid="filter-property-type-group">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Typ nemovitosti
          </label>
          <PropertyTypeFilter
            value={filters.property_type}
            onChange={(v) => setFilter("property_type", v)}
          />
        </div>

        <Separator className="bg-divider" />

        <div data-testid="filter-price-group">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cena
          </label>
          <PriceRangeSlider
            minValue={filters.price_min}
            maxValue={filters.price_max}
            onMinChange={(v) => setFilter("price_min", v)}
            onMaxChange={(v) => setFilter("price_max", v)}
          />
        </div>

        <div data-testid="filter-size-group">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plocha
          </label>
          <SizeRangeSlider
            minValue={filters.size_min}
            maxValue={filters.size_max}
            onMinChange={(v) => setFilter("size_min", v)}
            onMaxChange={(v) => setFilter("size_max", v)}
          />
        </div>

        <Separator className="bg-divider" />

        <div data-testid="filter-layout-group">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dispozice
          </label>
          <LayoutFilter
            value={filters.layout}
            onChange={(v) => setFilter("layout", v)}
          />
        </div>

        <Separator className="bg-divider" />

        <Accordion
          type="multiple"
          className="w-full"
          data-testid="filter-accordion"
        >
          <AccordionItem value="condition" data-testid="filter-condition-group">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              Stav
            </AccordionTrigger>
            <AccordionContent>
              <CheckboxGroupFilter
                options={conditionLabels}
                value={filters.condition}
                onChange={(v) => setFilter("condition", v)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="construction"
            data-testid="filter-construction-group"
          >
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              Konstrukce
            </AccordionTrigger>
            <AccordionContent>
              <CheckboxGroupFilter
                options={constructionLabels}
                value={filters.construction}
                onChange={(v) => setFilter("construction", v)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="ownership"
            data-testid="filter-ownership-group"
          >
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              Vlastnictví
            </AccordionTrigger>
            <AccordionContent>
              <CheckboxGroupFilter
                options={ownershipLabels}
                value={filters.ownership}
                onChange={(v) => setFilter("ownership", v)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="furnishing"
            data-testid="filter-furnishing-group"
          >
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              Vybavenost
            </AccordionTrigger>
            <AccordionContent>
              <CheckboxGroupFilter
                options={furnishingLabels}
                value={filters.furnishing}
                onChange={(v) => setFilter("furnishing", v)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="amenities"
            data-testid="filter-amenities-group"
          >
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              Vybavení
            </AccordionTrigger>
            <AccordionContent>
              <CheckboxGroupFilter
                options={amenityLabels}
                value={filters.amenities}
                onChange={(v) => setFilter("amenities", v)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="energy" data-testid="filter-energy-group">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              PENB
            </AccordionTrigger>
            <AccordionContent>
              <EnergyRatingFilter
                value={filters.energy_rating}
                onChange={(v) => setFilter("energy_rating", v)}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="source" data-testid="filter-source-group">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              Zdroj
            </AccordionTrigger>
            <AccordionContent>
              <SourceFilter
                value={filters.source}
                onChange={(v) => setFilter("source", v)}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </ScrollArea>
  );
}
