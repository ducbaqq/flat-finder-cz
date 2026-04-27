"use client";

import { useEffect } from "react";
import { trackEvent, sha256 } from "@/lib/analytics";

interface Props {
  outcomeKind:
    | "deleted"
    | "already_deleted"
    | "paused"
    | "manage_landing"
    | "invalid_token"
    | "no_token"
    | "error";
  watchdogId: number | null;
}

/**
 * Email-link entry point for watchdog pause/delete. The page itself is a
 * server component (so it can verify the HMAC token and execute the DB
 * mutation in render). This tiny client component runs on hydration and
 * fires the matching GA4 event. Without it the email-link kill path
 * would be invisible to analytics — which matters because most churn
 * happens here, not via the in-app modal.
 *
 * `already_deleted` fires `watchdog_delete` too: the user took the same
 * intentful action; bucketing by `result` lets the analyst tell apart
 * "first-time delete" from "re-clicked old link".
 */
export default function WatchdogManageTracking({
  outcomeKind,
  watchdogId,
}: Props) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const idHash =
        watchdogId != null ? await sha256(String(watchdogId)) : null;
      if (cancelled) return;

      if (outcomeKind === "deleted" || outcomeKind === "already_deleted") {
        trackEvent("watchdog_delete", {
          entry: "email_link",
          watchdog_id_hash: idHash,
          result: outcomeKind,
        });
      } else if (outcomeKind === "paused") {
        trackEvent("watchdog_pause", {
          entry: "email_link",
          watchdog_id_hash: idHash,
        });
      }
      // Other outcomes (invalid_token, error, manage_landing, no_token)
      // are not user-intent events worth their own GA4 row. The
      // page_view from AnalyticsListener already records the visit.
    })();
    return () => {
      cancelled = true;
    };
  }, [outcomeKind, watchdogId]);

  return null;
}
