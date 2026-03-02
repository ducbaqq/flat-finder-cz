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
            width="20"
            height="20"
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
            width="26"
            height="26"
            viewBox="0 0 26 26"
            fill="none"
          >
            <rect
              x="3"
              y="11"
              width="20"
              height="13"
              rx="2.5"
              fill="var(--color-primary)"
              opacity="0.12"
            />
            <path
              d="M13 2L2 12h22L13 2z"
              fill="var(--color-primary)"
            />
            <rect
              x="10"
              y="15"
              width="6"
              height="9"
              rx="1"
              fill="var(--color-primary)"
              opacity="0.5"
            />
            <rect
              x="11.5"
              y="17"
              width="3"
              height="3"
              rx="0.5"
              fill="var(--color-text-inverse)"
            />
          </svg>
          <span className="logo-text">
            flat<span className="logo-accent">finder</span>
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
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="watchdog-btn-text">Watchdog</span>
          {watchdogBadgeCount > 0 && (
            <span className="watchdog-badge">{watchdogBadgeCount}</span>
          )}
        </button>
        <div className="stats-bar">
          <span className="stat-item">
            {totalListings > 0
              ? `${totalListings.toLocaleString("cs-CZ")} nemovitost\u00ed`
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
