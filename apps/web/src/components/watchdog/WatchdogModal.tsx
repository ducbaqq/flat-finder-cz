"use client";

import { useCallback, useState } from "react";
import { Dog } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useWatchdogs } from "@/hooks/useWatchdogs";
import type { ListingFilters } from "@flat-finder/types";
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
  const closeWatchdogModal = useUiStore((s) => s.closeWatchdogModal);

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
        showToast("Hlídací pes uložen!");
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
        showToast("Hlídací pes smazán");
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Dog className="h-6 w-6 text-primary" />
              <DialogTitle>Hlídací pes</DialogTitle>
            </div>
            <DialogDescription>
              Dostanete e-mail, když se objeví nová nabídka odpovídající vašim
              filtrům.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="create">
            <TabsList className="w-full">
              <TabsTrigger value="create" className="flex-1">
                Nový hlídací pes
              </TabsTrigger>
              <TabsTrigger value="list" className="flex-1">
                Moji psi{watchdogs.length > 0 && ` (${watchdogs.length})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="mt-4">
              <WatchdogForm
                email={localEmail}
                onEmailChange={setLocalEmail}
                onEmailBlur={handleEmailBlur}
                onSave={handleSave}
                isCreating={isCreating}
              />
            </TabsContent>

            <TabsContent value="list" className="mt-4">
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
        <div className="fixed top-20 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
