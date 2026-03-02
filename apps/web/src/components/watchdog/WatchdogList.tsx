"use client";

import { useCallback, useState } from "react";
import type { Watchdog } from "@flat-finder/types";
import { getFilterSummaryTags } from "@/lib/utils";

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const handleDelete = useCallback(
    async (id: number) => {
      if (confirmDeleteId === id) {
        await onDelete(id);
        setConfirmDeleteId(null);
      } else {
        setConfirmDeleteId(id);
        setTimeout(() => setConfirmDeleteId(null), 3000);
      }
    },
    [confirmDeleteId, onDelete]
  );

  return (
    <div className="watchdog-list-section">
      <h3>Va\u0161i hl\u00eddac\u00ed psi (Your Watchdogs)</h3>

      <div className="watchdog-input-row" style={{ marginBottom: "var(--space-3)" }}>
        <label htmlFor="watchdogListEmail">E-mail pro vyhled\u00e1n\u00ed</label>
        <input
          type="email"
          id="watchdogListEmail"
          className="filter-input"
          placeholder="vas@email.cz"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onBlur={onEmailBlur}
        />
      </div>

      <div className="watchdog-list">
        {watchdogs.length === 0 ? (
          <p className="watchdog-list-empty">
            {email && email.includes("@")
              ? "Zat\u00edm nem\u00e1te \u017e\u00e1dn\u00e9 hl\u00eddac\u00ed psy."
              : "Zadejte e-mail v\u00fd\u0161e pro zobrazen\u00ed hl\u00eddac\u00edch ps\u016f."}
            <br />
            <small>
              {email && email.includes("@")
                ? "You don't have any watchdogs yet."
                : "Enter your email above to view your watchdogs."}
            </small>
          </p>
        ) : (
          watchdogs.map((w) => {
            const tags = getFilterSummaryTags(
              (w.filters || {}) as Record<string, string>
            );
            const label = w.label || "Hl\u00eddac\u00ed pes #" + w.id;
            return (
              <div
                key={w.id}
                className={`watchdog-item${w.active ? "" : " inactive"}`}
              >
                <div className="watchdog-item-info">
                  <div className="watchdog-item-label">{label}</div>
                  <div className="watchdog-item-email">{w.email}</div>
                  <div className="watchdog-item-filters">
                    {tags.length ? (
                      tags.map((t, i) => (
                        <span key={i} className="filter-tag">
                          {t.label}: {t.value}
                        </span>
                      ))
                    ) : (
                      <span className="filter-tag">
                        V\u0161e (All listings)
                      </span>
                    )}
                  </div>
                </div>
                <div className="watchdog-item-actions">
                  <button
                    className="toggle-btn"
                    onClick={() => onToggle(w.id)}
                    title={
                      w.active
                        ? "Pozastavit (Pause)"
                        : "Aktivovat (Activate)"
                    }
                  >
                    {w.active ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="6" y="4" width="4" height="16" />
                        <rect x="14" y="4" width="4" height="16" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(w.id)}
                    title={
                      confirmDeleteId === w.id
                        ? "Klikn\u011bte znovu pro potvrzen\u00ed (Click again to confirm)"
                        : "Smazat (Delete)"
                    }
                    style={
                      confirmDeleteId === w.id
                        ? {
                            background: "oklch(0.6 0.2 25 / 0.1)",
                            color: "oklch(0.6 0.2 25)",
                            borderColor: "oklch(0.6 0.2 25 / 0.3)",
                          }
                        : undefined
                    }
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
