"use client";

import { useFilterStore } from "@/store/filter-store";
import { useTheme } from "@/hooks/useTheme";

interface TopBarProps {
  watchdogBadgeCount: number;
  totalListings: number;
}

export default function TopBar({
  watchdogBadgeCount,
  totalListings,
}: TopBarProps) {
  const toggleSidebar = useFilterStore((s) => s.toggleSidebar);
  const toggleWatchdogModal = useFilterStore((s) => s.toggleWatchdogModal);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle filters"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>
        <div className="logo">
          <svg
            className="logo-icon"
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
          >
            <rect
              x="2"
              y="10"
              width="24"
              height="16"
              rx="2"
              fill="currentColor"
              opacity="0.15"
            />
            <path d="M14 2L2 12h24L14 2z" fill="var(--color-primary)" />
            <rect
              x="10"
              y="16"
              width="8"
              height="10"
              rx="1"
              fill="var(--color-primary)"
              opacity="0.6"
            />
            <rect
              x="12"
              y="18"
              width="4"
              height="4"
              rx="0.5"
              fill="var(--color-text-inverse)"
            />
          </svg>
          <span className="logo-text">
            Flat Finder <span className="logo-accent">CZ</span>
          </span>
        </div>
      </div>
      <div className="topbar-right">
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
          {watchdogBadgeCount > 0 && (
            <span className="watchdog-badge">{watchdogBadgeCount}</span>
          )}
        </button>
        <div className="stats-bar">
          <span className="stat-item">
            {totalListings > 0
              ? `${totalListings} nemovitost\u00ed`
              : "\u2014"}
          </span>
        </div>
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
