import type { Db } from "@flat-finder/db";
import { deactivateStaleListings, deactivateByTtlListings, deduplicateListings } from "@flat-finder/db";

/**
 * Deactivate listings from `source` that were NOT seen in thne current run.
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
 * Deactivate active listings that are duplicates on (price, layout, size_m2, description).
 * Keeps the earliest (lowest id) listing per group; deactivates the rest.
 */
export async function deduplicateActive(
  db: Db,
): Promise<{ found: number; deactivated: number }> {
  const t = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
  const result = await deduplicateListings(db);
  if (result.found > 0) {
    console.log(
      `${t()} [deactivator] Deduplication: ${result.found} duplicates found, ${result.deactivated} deactivated`,
    );
  } else {
    console.log(`${t()} [deactivator] Deduplication: no duplicates found`);
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
