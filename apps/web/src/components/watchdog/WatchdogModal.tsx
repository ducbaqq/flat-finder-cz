"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dog } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useWatchdogs } from "@/hooks/useWatchdogs";
import type { ListingFilters } from "@flat-finder/types";

// URL params that are NOT user-search filters and must NOT be persisted as
// part of a watchdog's saved filter set. `sort`/`view` control client-side
// rendering; `watchdog` and `listing` are modal-open signals.
const NON_FILTER_URL_PARAMS = new Set(["sort", "view", "watchdog", "listing"]);
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WatchdogForm from "./WatchdogForm";
import WatchdogList from "./WatchdogList";

export default function WatchdogModal() {
  const watchdogModalOpen = useUiStore((s) => s.watchdogModalOpen);
  const toggleWatchdogModal = useUiStore((s) => s.toggleWatchdogModal);
  const closeWatchdogModal = useUiStore((s) => s.closeWatchdogModal);
  const mapBounds = useUiStore((s) => s.mapBounds);

  // Snapshot URL search params + map viewport when the modal opens. The
  // form needs these for both display ("Aktuální filtry: …") and the save
  // payload (otherwise the watchdog would persist an empty filter set and
  // match every listing). Re-read on each open so navigating between
  // searches before opening the modal picks up the right filters.
  const [urlParamsSnapshot, setUrlParamsSnapshot] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    if (!watchdogModalOpen) return;
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      if (value && !NON_FILTER_URL_PARAMS.has(key)) result[key] = value;
    });
    setUrlParamsSnapshot(result);
  }, [watchdogModalOpen]);

  // Compose the filter view passed to the form: URL params (for display
  // tags + most filters) plus current map viewport (so "location: Praha 6"
  // actually filters geographically once saved).
  const currentFilters = useMemo<Record<string, string>>(() => {
    const result = { ...urlParamsSnapshot };
    if (mapBounds && urlParamsSnapshot.location) {
      result.sw_lat = String(mapBounds.sw_lat);
      result.sw_lng = String(mapBounds.sw_lng);
      result.ne_lat = String(mapBounds.ne_lat);
      result.ne_lng = String(mapBounds.ne_lng);
    }
    return result;
  }, [urlParamsSnapshot, mapBounds]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("watchdog") && !watchdogModalOpen) {
      toggleWatchdogModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    email,
    setWatchdogEmail,
    watchdogs,
    createWatchdog,
    isCreating,
    toggleWatchdog,
    deleteWatchdog,
  } = useWatchdogs();

  const [localEmail, setLocalEmail] = useState("");
  const [toast, setToast] = useState("");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const handleEmailBlur = useCallback(() => {
    const trimmed = localEmail.trim();
    if (trimmed && trimmed.includes("@") && trimmed !== email) {
      setWatchdogEmail(trimmed);
    }
  }, [localEmail, email, setWatchdogEmail]);

  const handleSave = useCallback(
    async (data: { email: string; filters: ListingFilters; label?: string }) => {
      try {
        setWatchdogEmail(data.email);
        await createWatchdog(data);
        showToast("Hlídač nemovitostí uložen!");
      } catch {
        showToast("Chyba při ukládání");
      }
    },
    [createWatchdog, setWatchdogEmail, showToast]
  );

  const handleToggle = useCallback(
    async (id: number) => {
      try {
        await toggleWatchdog(id);
      } catch (e) {
        console.error("Toggle failed", e);
      }
    },
    [toggleWatchdog]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteWatchdog(id);
        showToast("Hlídač nemovitostí smazán");
      } catch (e) {
        console.error("Delete failed", e);
      }
    },
    [deleteWatchdog, showToast]
  );

  return (
    <>
      <Dialog
        open={watchdogModalOpen}
        onOpenChange={(open) => !open && closeWatchdogModal()}
      >
        <DialogContent className="max-w-lg" data-testid="watchdog-modal">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Dog className="h-6 w-6 text-primary" />
              <DialogTitle>Hlídač nemovitostí</DialogTitle>
            </div>
            <DialogDescription>
              Dostanete e-mail, když se objeví nová nabídka odpovídající vašim
              filtrům.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="create" data-testid="watchdog-tabs">
            <TabsList className="w-full">
              <TabsTrigger value="create" className="flex-1" data-testid="watchdog-tab-create">
                Nový hlídač nemovitostí
              </TabsTrigger>
              <TabsTrigger value="list" className="flex-1" data-testid="watchdog-tab-list">
                {/* FIXME(czech-grammar) — dropping "nemovitostí" to avoid tab overflow; review */}
                Moji hlídači{watchdogs.length > 0 && ` (${watchdogs.length})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="mt-4" data-testid="watchdog-create-panel">
              <WatchdogForm
                email={localEmail}
                onEmailChange={setLocalEmail}
                onEmailBlur={handleEmailBlur}
                onSave={handleSave}
                isCreating={isCreating}
                currentFilters={currentFilters}
              />
            </TabsContent>

            <TabsContent value="list" className="mt-4" data-testid="watchdog-list-panel">
              <WatchdogList
                email={localEmail}
                onEmailChange={setLocalEmail}
                onEmailBlur={handleEmailBlur}
                watchdogs={watchdogs}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed top-20 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg" data-testid="watchdog-toast">
          {toast}
        </div>
      )}
    </>
  );
}
