import type { Db } from "@flat-finder/db";
import { deactivateStaleListings, deactivateByTtlListings, clusterListings, clusterNewListings } from "@flat-finder/db";

/**
 * Deactivate listings from `source` that were NOT seen in the current run.
 *
 * Wraps the database helper from @flat-finder/db and logs the result.
 */
export async function deactivateStale(
  db: Db,
  source: string,
  seenIds: Set<string>,
): Promise<number> {
  const t = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
  if (seenIds.size === 0) {
    console.warn(
      `${t()} [deactivator] deactivateStale called with empty seenIds for ${source} -- skipping to avoid mass deactivation`,
    );
    return 0;
  }

  const count = await deactivateStaleListings(db, source, seenIds);
  if (count > 0) {
    console.log(`${t()} [deactivator] Deactivated ${count} stale listings for source=${source}`);
  }
  return count;
}

/**
 * Cluster duplicate listings across sources by geo + size + price + transaction_type.
 * Assigns cluster_id + is_canonical — does NOT deactivate anything. Listings
 * without coordinates remain unclustered (see clusterListings for rationale).
 *
 * When `dryRun` is true, runs inside a transaction that is rolled back, so the
 * returned counts reflect what would happen without persisting any changes.
 */
export async function clusterDuplicates(
  db: Db,
  opts: { dryRun?: boolean } = {},
): Promise<{ clustered: number; clusters: number }> {
  const t = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
  const result = await clusterListings(db, opts);
  const prefix = opts.dryRun ? "[dedup dry-run]" : "[dedup]";
  if (result.clusters > 0) {
    console.log(
      `${t()} ${prefix} Clustering ${opts.dryRun ? "preview" : "complete"}: ${result.clusters} clusters, ${result.clustered} listings grouped`,
    );
  } else {
    console.log(`${t()} ${prefix} No duplicate clusters found`);
  }
  return result;
}

/**
 * SCR-09: TTL-based deactivation.
 * Deactivates active listings whose scraped_at is older than `ttlDays` days.
 * Can run in any mode (incremental, watch, or standalone --cleanup).
 */
export async function deactivateByTtl(
  db: Db,
  ttlDays: number,
): Promise<number> {
  const t = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
  const count = await deactivateByTtlListings(db, ttlDays);
  if (count > 0) {
    console.log(
      `${t()} [deactivator] TTL deactivation: ${count} listings not scraped in ${ttlDays}+ days`,
    );
  }
  return count;
}

/**
 * Incremental dedup — clusters new active listings against existing clusters
 * and each other. Designed for the end-of-cycle hook in the watch loop.
 * Does NOT replace clusterDuplicates (the full rebuild).
 *
 * Failure mode: any error is logged and swallowed so the caller (the watch
 * loop) continues into its sleep. The next cycle retries in 5 min.
 */
export async function clusterNewDuplicates(db: Db): Promise<void> {
  const t = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
  const started = Date.now();
  try {
    const result = await clusterNewListings(db);
    const ms = Date.now() - started;
    if (result.clustered === 0) {
      console.log(`${t()} [dedup-inc] No new clusters (${ms} ms)`);
      return;
    }
    console.log(
      `${t()} [dedup-inc] ${result.clustered} rows -> ${result.clusters} clusters ` +
        `(${result.joined_existing} joined existing, ` +
        `${result.clustered - result.joined_existing} new-cluster members) in ${ms} ms`,
    );
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`${t()} [dedup-inc] FAILED after ${ms} ms:`, err);
  }
}
