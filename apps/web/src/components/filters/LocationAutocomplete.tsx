"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDebounce } from "@/hooks/useDebounce";
import { apiGet } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";
import type { SuggestItem, SuggestResponse } from "@flat-finder/types";

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function LocationAutocomplete({
  value,
  onChange,
  className,
}: LocationAutocompleteProps) {
  const setPendingBbox = useUiStore((s) => s.setPendingBbox);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const justSelectedRef = useRef(false);

  const debouncedQuery = useDebounce(draft, 300);

  // Sync draft when the external value changes (e.g. filter chip removed)
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Fetch suggestions when debounced query changes
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setItems([]);
      return;
    }

    const controller = new AbortController();

    apiGet<SuggestResponse>(
      "/suggest",
      { query: debouncedQuery },
      { signal: controller.signal }
    )
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (err.name !== "AbortError") {
          setItems([]);
        }
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery]);

  const open = items.length > 0 && focused;

  const handleSelect = useCallback(
    (item: SuggestItem) => {
      const display = item.location ? `${item.name}, ${item.location}` : item.name;
      justSelectedRef.current = true;
      setDraft(display);
      onChange(display);
      setPendingBbox(item.bbox ?? null);
      setItems([]);
    },
    [onChange, setPendingBbox]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onChange(draft.trim());
        setItems([]);
      } else if (e.key === "Escape") {
        setItems([]);
      }
    },
    [draft, onChange]
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    setTimeout(() => {
      if (justSelectedRef.current) {
        justSelectedRef.current = false;
        return;
      }
      if (draft.trim() !== value) {
        onChange(draft.trim());
      }
      setItems([]);
    }, 150);
  }, [draft, value, onChange]);

  return (
    <Popover open={open} onOpenChange={() => {}}>
      <PopoverAnchor asChild>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Město nebo lokalita..."
          className={className}
          data-testid="filter-location"
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] bg-white p-0 dark:bg-zinc-900"
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={`${item.name}-${item.location ?? ""}-${item.type}`}
                  value={`${item.label}-${item.location ?? ""}`}
                  onSelect={() => handleSelect(item)}
                  className="data-[selected=true]:bg-muted data-[selected=true]:text-foreground hover:bg-muted"
                >
                  <MapPin className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm">{item.name}</span>
                    {item.location && (
                      <span className="text-xs text-muted-foreground">
                        {item.location}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
