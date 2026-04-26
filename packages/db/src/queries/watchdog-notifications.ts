import {
  watchdogNotifications,
  type NewWatchdogNotification,
} from "../schema/watchdog-notifications.js";
import type { Db } from "../client.js";

/**
 * Compute the cluster_key the worker uses to dedup notifications across
 * portals and listing IDs. Cluster-bearing rows collapse to their cluster
 * id; everything else falls back to a per-listing singleton key.
 *
 * Worker computes this server-side — never trust caller data.
 */
export function clusterKeyFor(listing: {
  id: number;
  cluster_id: string | null;
}): string {
  return listing.cluster_id
    ? `cluster:${listing.cluster_id}`
    : `singleton:${listing.id}`;
}

/**
 * Insert one audit row per cluster_key for this canonical email. Called
 * from the worker's post-Brevo-2xx transaction. ON CONFLICT DO NOTHING
 * makes the operation idempotent (same email sent twice in the same
 * cycle, race against the partial unique index, etc.).
 */
export async function insertWatchdogNotificationsBatch(
  db: Db,
  emailCanonical: string,
  clusterKeys: string[],
): Promise<void> {
  if (clusterKeys.length === 0) return;
  const rows: NewWatchdogNotification[] = clusterKeys.map((clusterKey) => ({
    email_canonical: emailCanonical,
    cluster_key: clusterKey,
  }));
  await db.insert(watchdogNotifications).values(rows).onConflictDoNothing();
}
