"use client";

import { useState } from "react";
import { Loader2, Pause, Play, Search, Trash2 } from "lucide-react";
import type { Watchdog } from "@flat-finder/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getFilterSummaryTags } from "@/lib/utils";
import { cn } from "@/lib/cn";

interface WatchdogListProps {
  email: string;
  onEmailChange: (email: string) => void;
  onSearch: () => void;
  watchdogs: Watchdog[];
  onToggle: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  /** True while the GET /watchdogs query is in flight. */
  isFetching: boolean;
  /** True once an email has been committed to the query (a search ran). */
  hasSearched: boolean;
}

export default function WatchdogList({
  email,
  onEmailChange,
  onSearch,
  watchdogs,
  onToggle,
  onDelete,
  isFetching,
  hasSearched,
}: WatchdogListProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const trimmed = email.trim();
  const isValidEmail = trimmed.length > 0 && trimmed.includes("@");
  const buttonDisabled = !isValidEmail || isFetching;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!buttonDisabled) onSearch();
  };

  return (
    <div className="space-y-4" data-testid="watchdog-list">
      <form onSubmit={handleSubmit} className="space-y-2">
        <Label htmlFor="watchdogListEmail">E-mail pro vyhledání</Label>
        <Input
          type="email"
          id="watchdogListEmail"
          placeholder="vas@email.cz"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          disabled={isFetching}
          data-testid="watchdog-list-email"
        />
        <Button
          type="submit"
          className="w-full"
          disabled={buttonDisabled}
          data-testid="watchdog-list-search-submit"
        >
          {isFetching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Načítám…
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              Zobrazit hlídače
            </>
          )}
        </Button>
      </form>

      <div className="space-y-2" data-testid="watchdog-list-items">
        {!hasSearched ? (
          <p
            className="py-4 text-center text-sm text-muted-foreground"
            data-testid="watchdog-list-prompt"
          >
            Zadej e-mail výše a klikni na <span className="font-medium">Zobrazit hlídače</span>.
          </p>
        ) : watchdogs.length === 0 ? (
          <p
            className="py-4 text-center text-sm text-muted-foreground"
            data-testid="watchdog-list-empty"
          >
            {/* FIXME(czech-grammar) — review accusative form once shipping. */}
            Pro tento e-mail nemáme žádné aktivní hlídače.
          </p>
        ) : (
          watchdogs.map((w) => {
            const tags = getFilterSummaryTags(
              (w.filters || {}) as Record<string, string>
            );
            return (
              <div
                key={w.id}
                className={cn(
                  "rounded-lg border p-3 transition-opacity",
                  !w.active && "opacity-50"
                )}
                data-testid="watchdog-item"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" data-testid="watchdog-item-name">
                      {w.label || `Hlídač nemovitostí #${w.id}`}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid="watchdog-item-email">{w.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1" data-testid="watchdog-item-filters">
                      {tags.length > 0 ? (
                        tags.map((t, i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {t.label}: {t.value}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Vše
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onToggle(w.id)}
                      title={w.active ? "Pozastavit" : "Aktivovat"}
                      data-testid="watchdog-item-toggle"
                    >
                      {w.active ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          data-testid="watchdog-item-delete-trigger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent data-testid="watchdog-delete-dialog">
                        <AlertDialogHeader>
                          {/* FIXME(czech-grammar) — accusative collision; nominative kept verbatim, review */}
                          <AlertDialogTitle>Smazat Hlídač nemovitostí?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tato akce je nevratná. Hlídač nemovitostí bude trvale
                            smazán.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="watchdog-delete-cancel">Zrušit</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              setDeletingId(w.id);
                              await onDelete(w.id);
                              setDeletingId(null);
                            }}
                            disabled={deletingId === w.id}
                            data-testid="watchdog-delete-confirm"
                          >
                            {deletingId === w.id ? "Mažu..." : "Smazat"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
