"use client";

import { useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
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
  onEmailBlur: () => void;
  watchdogs: Watchdog[];
  onToggle: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export default function WatchdogList({
  email,
  onEmailChange,
  onEmailBlur,
  watchdogs,
  onToggle,
  onDelete,
}: WatchdogListProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="watchdogListEmail">E-mail pro vyhledání</Label>
        <Input
          type="email"
          id="watchdogListEmail"
          placeholder="vas@email.cz"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onBlur={onEmailBlur}
        />
      </div>

      <div className="space-y-2">
        {watchdogs.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {email && email.includes("@")
              ? "Zatím nemáte žádné hlídací psy."
              : "Zadejte e-mail výše pro zobrazení hlídacích psů."}
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
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {w.label || `Hlídací pes #${w.id}`}
                    </p>
                    <p className="text-xs text-muted-foreground">{w.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
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
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Smazat hlídacího psa?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tato akce je nevratná. Hlídací pes bude trvale
                            smazán.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Zrušit</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              setDeletingId(w.id);
                              await onDelete(w.id);
                              setDeletingId(null);
                            }}
                            disabled={deletingId === w.id}
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
