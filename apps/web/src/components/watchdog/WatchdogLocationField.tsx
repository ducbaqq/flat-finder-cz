"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { SuggestItem, SuggestResponse } from "@flat-finder/types";

export type Bbox = [number, number, number, number] | null;

interface WatchdogLocationFieldProps {
  value: string;
  bbox: Bbox;
  onChange: (value: string, bbox: Bbox) => void;
}

/**
 * Local-only location field for the WatchdogForm. Behaves like
 * `LocationAutocomplete` but keeps its bbox in the parent form's state
 * instead of pushing it onto the global `useUiStore.pendingBbox` channel —
 * editing the modal must not mutate the underlying /search viewport.
 */
export function WatchdogLocationField({
  value,
  bbox,
  onChange,
}: WatchdogLocationFieldProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const justSelectedRef = useRef(false);

  const debounced = useDebounce(draft, 300);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (debounced.length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    apiGet<SuggestResponse>(
      "/suggest",
      { query: debounced },
      { signal: controller.signal }
    )
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (err.name !== "AbortError") setItems([]);
      });
    return () => controller.abort();
  }, [debounced]);

  const handleSelect = useCallback(
    (item: SuggestItem) => {
      const display = item.location ? `${item.name}, ${item.location}` : item.name;
      justSelectedRef.current = true;
      setDraft(display);
      onChange(display, item.bbox ?? null);
      setItems([]);
    },
    [onChange]
  );

  const handleType = useCallback(
    (next: string) => {
      setDraft(next);
      // The bbox tied to the previous location text is now stale — drop it.
      // It will be re-attached only if the user picks an autocomplete item.
      if (bbox) onChange(next, null);
      else onChange(next, null);
    },
    [bbox, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onChange(draft.trim(), null);
        setItems([]);
      } else if (e.key === "Escape") {
        setItems([]);
      }
    },
    [draft, onChange]
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    // Defer so an autocomplete click can complete first.
    setTimeout(() => {
      if (justSelectedRef.current) {
        justSelectedRef.current = false;
        return;
      }
      if (draft.trim() !== value) {
        onChange(draft.trim(), null);
      }
      setItems([]);
    }, 150);
  }, [draft, value, onChange]);

  const open = items.length > 0 && focused;

  return (
    <Popover open={open} onOpenChange={() => {}}>
      <PopoverAnchor asChild>
        <Input
          value={draft}
          onChange={(e) => handleType(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Město nebo lokalita..."
          data-testid="watchdog-form-filter-location"
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
