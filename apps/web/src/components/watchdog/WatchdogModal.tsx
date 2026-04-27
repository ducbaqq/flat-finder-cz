"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dog } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useWatchdogs } from "@/hooks/useWatchdogs";
import { trackEvent, sha256, getSurface } from "@/lib/analytics";
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
import WatchdogSuccess from "./WatchdogSuccess";

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
    isFetching: isFetchingWatchdogs,
    hasSearched,
  } = useWatchdogs();

  const [localEmail, setLocalEmail] = useState("");
  const [toast, setToast] = useState("");
  const [activeTab, setActiveTab] = useState<"create" | "list">("create");
  // Holds the API error from the most recent save attempt so the form
  // can surface it (rather than the generic "Chyba při ukládání" toast
  // that silently dropped the server's actual reason). Click handler on
  // the rendered error sends the user to the "Moji hlídači" tab so they
  // can act on the most common cause: duplicate-email 409.
  const [saveError, setSaveError] = useState("");

  // Holds the just-saved watchdog so the modal can swap from the create
  // form to a success screen without losing what the user just configured.
  // Reset to `null` when the modal closes (any path) so reopening lands
  // back on the form.
  const [savedWatchdog, setSavedWatchdog] = useState<{
    email: string;
    label: string | null;
    filters: ListingFilters;
  } | null>(null);

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

  /**
   * Explicit "Zobrazit hlídače" search trigger from the list tab — the
   * tab no longer auto-fetches on input blur (was confusing because it
   * gave no feedback). Commits the typed email to the hook, which fires
   * the query.
   */
  const handleSearchWatchdogs = useCallback(() => {
    const trimmed = localEmail.trim();
    if (trimmed && trimmed.includes("@")) {
      setWatchdogEmail(trimmed);
    }
  }, [localEmail, setWatchdogEmail]);

  const handleSave = useCallback(
    async (data: { email: string; filters: ListingFilters; label?: string }) => {
      setSaveError("");
      try {
        setWatchdogEmail(data.email);
        await createWatchdog(data);
        // Replace the toast confirmation with the in-modal success screen.
        setSavedWatchdog({
          email: data.email,
          label: data.label?.trim() ? data.label.trim() : null,
          filters: data.filters,
        });
        // Retention proxy event. Filter shape is summarized into booleans
        // + count so GA4 reports stay readable; the raw filter values are
        // already in `page_location`.
        trackEvent("watchdog_create", {
          surface: getSurface(),
          filters_count: Object.keys(data.filters).length,
          has_location: !!data.filters.location,
          has_price_range:
            data.filters.price_min != null || data.filters.price_max != null,
          has_property_type: !!data.filters.property_type,
        });
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Chyba při ukládání";
        setSaveError(message);
      }
    },
    [createWatchdog, setWatchdogEmail]
  );

  const handleErrorClick = useCallback(() => {
    // The 409 duplicate-email message tells the user to delete or edit
    // the existing watchdog — only actionable from the list tab. Switch
    // tabs and commit the typed email so the list query fires
    // immediately, mirroring the explicit "Zobrazit hlídače" path.
    setSaveError("");
    const trimmed = localEmail.trim();
    if (trimmed && trimmed.includes("@")) {
      setWatchdogEmail(trimmed);
    }
    setActiveTab("list");
  }, [localEmail, setWatchdogEmail]);

  // Single dismissal path used by both the success screen's OK button
  // and the dialog's overlay/Esc/X. Reset success/error/tab state BEFORE
  // closing so reopening always starts on the form, on the create tab,
  // with no stale error.
  const handleClose = useCallback(() => {
    setSavedWatchdog(null);
    setSaveError("");
    setActiveTab("create");
    closeWatchdogModal();
  }, [closeWatchdogModal]);

  const handleToggle = useCallback(
    async (id: number) => {
      // Capture the previous active state before toggling so we can fire
      // pause vs resume distinctly. Falls back to "pause" if the row
      // isn't found locally (shouldn't happen — list and handler share
      // the same fetched payload).
      const prev = watchdogs.find((w) => w.id === id);
      const wasActive = prev?.active ?? true;
      try {
        await toggleWatchdog(id);
        const idHash = await sha256(String(id));
        trackEvent(wasActive ? "watchdog_pause" : "watchdog_resume", {
          entry: "modal",
          watchdog_id_hash: idHash,
        });
      } catch (e) {
        console.error("Toggle failed", e);
      }
    },
    [toggleWatchdog, watchdogs]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteWatchdog(id);
        showToast("Hlídač nemovitostí smazán");
        const idHash = await sha256(String(id));
        trackEvent("watchdog_delete", {
          entry: "modal",
          watchdog_id_hash: idHash,
        });
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
        onOpenChange={(open) => !open && handleClose()}
      >
        {/*
          Cap the modal at 90 % of the dynamic viewport height (`100dvh`
          handles the iOS Safari URL-bar height correctly) and let the
          content overflow-scroll inside. The close button is positioned
          absolute on DialogContent so it stays pinned at top-right while
          the inner content scrolls.
        */}
        <DialogContent
          className="max-w-lg max-h-[90dvh] overflow-y-auto"
          data-testid="watchdog-modal"
        >
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

          {savedWatchdog ? (
            <WatchdogSuccess
              email={savedWatchdog.email}
              label={savedWatchdog.label}
              filters={savedWatchdog.filters}
              onClose={handleClose}
            />
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "create" | "list")}
              data-testid="watchdog-tabs"
            >
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
                  saveError={saveError}
                  onErrorClick={handleErrorClick}
                />
              </TabsContent>

              <TabsContent value="list" className="mt-4" data-testid="watchdog-list-panel">
                <WatchdogList
                  email={localEmail}
                  onEmailChange={setLocalEmail}
                  onSearch={handleSearchWatchdogs}
                  watchdogs={watchdogs}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  isFetching={isFetchingWatchdogs}
                  hasSearched={hasSearched}
                />
              </TabsContent>
            </Tabs>
          )}
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
