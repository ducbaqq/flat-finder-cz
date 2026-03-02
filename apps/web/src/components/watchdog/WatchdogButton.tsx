"use client";

// This component is integrated into TopBar directly.
// Exported for potential standalone use.
import { useFilterStore } from "@/store/filter-store";

interface WatchdogButtonProps {
  badgeCount: number;
}

export default function WatchdogButton({ badgeCount }: WatchdogButtonProps) {
  const toggleWatchdogModal = useFilterStore((s) => s.toggleWatchdogModal);

  return (
    <button
      className="watchdog-btn"
      onClick={toggleWatchdogModal}
      title="Hl\u00eddac\u00ed pes (Watchdog)"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .137 1.217 1.5 2 1.5 2s.46 1.967 1 3c.54 1.033.863 1.56 1.5 2 .637.44 3.5 1 3.5 1m0-12.828c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.137 1.217-1.5 2-1.5 2s-.46 1.967-1 3c-.54 1.033-.863 1.56-1.5 2-.637.44-3.5 1-3.5 1" />
        <path d="M6.5 20c.893.26 2.187.5 3.5.5s2.607-.24 3.5-.5" />
        <circle cx="10" cy="10" r="1" fill="currentColor" />
      </svg>
      <span className="watchdog-btn-text">Hl\u00eddac\u00ed pes</span>
      {badgeCount > 0 && (
        <span className="watchdog-badge">{badgeCount}</span>
      )}
    </button>
  );
}
