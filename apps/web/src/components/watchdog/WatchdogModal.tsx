"use client";

import { useEffect, useCallback, useState } from "react";
import { useFilterStore } from "@/store/filter-store";
import { useWatchdogs } from "@/hooks/useWatchdogs";
import type { ListingFilters } from "@flat-finder/types";
import WatchdogForm from "./WatchdogForm";
import WatchdogList from "./WatchdogList";

type TabView = "create" | "list";

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div className={`watchdog-toast${visible ? " visible" : ""}`}>
      {message}
    </div>
  );
}

export default function WatchdogModal() {
  const watchdogModalOpen = useFilterStore((s) => s.watchdogModalOpen);
  const closeWatchdogModal = useFilterStore((s) => s.closeWatchdogModal);

  const {
    email,
    setWatchdogEmail,
    watchdogs,
    createWatchdog,
    isCreating,
    toggleWatchdog,
    deleteWatchdog,
  } = useWatchdogs();

  const [activeTab, setActiveTab] = useState<TabView>("create");
  const [localEmail, setLocalEmail] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    visible: boolean;
  }>({ message: "", visible: false });

  // Sync local email with hook email
  useEffect(() => {
    if (email) {
      setLocalEmail(email);
    }
  }, [email]);

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3000);
  }, []);

  const handleEmailBlur = useCallback(() => {
    const trimmed = localEmail.trim();
    if (trimmed && trimmed.includes("@") && trimmed !== email) {
      setWatchdogEmail(trimmed);
    }
  }, [localEmail, email, setWatchdogEmail]);

  const handleSave = useCallback(
    async (data: {
      email: string;
      filters: ListingFilters;
      label?: string;
    }) => {
      try {
        setWatchdogEmail(data.email);
        await createWatchdog(data);
        showToast("Hl\u00eddac\u00ed pes ulo\u017een (Watchdog saved)");
      } catch {
        showToast("Chyba p\u0159i ukl\u00e1d\u00e1n\u00ed (Save failed)");
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
        showToast("Hl\u00eddac\u00ed pes smaz\u00e1n (Watchdog deleted)");
      } catch (e) {
        console.error("Delete failed", e);
      }
    },
    [deleteWatchdog, showToast]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && watchdogModalOpen) {
        closeWatchdogModal();
      }
    },
    [watchdogModalOpen, closeWatchdogModal]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeWatchdogModal();
      }
    },
    [closeWatchdogModal]
  );

  if (!watchdogModalOpen) return null;

  return (
    <>
      <div
        className="modal-overlay active"
        onClick={handleOverlayClick}
      >
        <div className="modal watchdog-modal" role="dialog" aria-modal="true">
          <button
            className="modal-close"
            onClick={closeWatchdogModal}
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className="watchdog-modal-body">
            <div className="watchdog-modal-header">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="2"
              >
                <path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .137 1.217 1.5 2 1.5 2s.46 1.967 1 3c.54 1.033.863 1.56 1.5 2 .637.44 3.5 1 3.5 1m0-12.828c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.137 1.217-1.5 2-1.5 2s-.46 1.967-1 3c-.54 1.033-.863 1.56-1.5 2-.637.44-3.5 1-3.5 1" />
                <path d="M6.5 20c.893.26 2.187.5 3.5.5s2.607-.24 3.5-.5" />
                <circle cx="10" cy="10" r="1" fill="currentColor" />
              </svg>
              <h2>Hl\u00eddac\u00ed pes (Watchdog)</h2>
              <p className="watchdog-subtitle">
                Dostanete e-mail, kdy\u017e se objev\u00ed nov\u00e1 nab\u00eddka odpov\u00eddaj\u00edc\u00ed va\u0161im filtr\u016fm.
                <br />
                You&apos;ll get an email when a new listing matches your filters.
              </p>
            </div>

            <div className="watchdog-tabs">
              <button
                className={`watchdog-tab${activeTab === "create" ? " active" : ""}`}
                onClick={() => setActiveTab("create")}
              >
                Nov\u00fd (Create)
              </button>
              <button
                className={`watchdog-tab${activeTab === "list" ? " active" : ""}`}
                onClick={() => setActiveTab("list")}
              >
                Moji psi (My Watchdogs)
                {watchdogs.length > 0 && ` (${watchdogs.length})`}
              </button>
            </div>

            {activeTab === "create" ? (
              <WatchdogForm
                email={localEmail}
                onEmailChange={setLocalEmail}
                onEmailBlur={handleEmailBlur}
                onSave={handleSave}
                isCreating={isCreating}
              />
            ) : (
              <WatchdogList
                email={localEmail}
                onEmailChange={setLocalEmail}
                onEmailBlur={handleEmailBlur}
                watchdogs={watchdogs}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            )}
          </div>
        </div>
      </div>
      <Toast message={toast.message} visible={toast.visible} />
    </>
  );
}
