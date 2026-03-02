import { and, count, desc, gt } from "drizzle-orm";
import {
  type Db,
  listings,
  type ListingRow,
  buildWhereConditions,
} from "@flat-finder/db";
import type { ListingFilters } from "@flat-finder/types";
import type { WatchdogRow } from "@flat-finder/db";

const MAX_LISTINGS_PER_EMAIL = 20;

export interface MatchResult {
  total: number;
  listings: ListingRow[];
}

/**
 * Find listings matching a watchdog's filters that were created after the
 * last notification (or after the watchdog was created if never notified).
 */
export async function findMatchingListings(
  db: Db,
  watchdog: WatchdogRow,
): Promise<MatchResult> {
  // Cutoff: last_notified_at, or created_at for never-notified watchdogs
  const cutoff = watchdog.last_notified_at ?? watchdog.created_at ?? "1970-01-01 00:00:00";

  // Parse the watchdog filters (stored as JSONB)
  const filters: ListingFilters =
    (watchdog.filters as ListingFilters | null) ?? {};

  // Build the base conditions from the watchdog's filters
  // buildWhereConditions already adds is_active = true by default
  const baseConditions = buildWhereConditions(filters);

  // Add the cutoff condition: only listings created after the cutoff
  const allConditions = [...baseConditions, gt(listings.created_at, cutoff)];

  const where = and(...allConditions);

  // Count total matches
  const [totalResult] = await db
    .select({ count: count() })
    .from(listings)
    .where(where);

  const total = totalResult?.count ?? 0;

  if (total === 0) {
    return { total: 0, listings: [] };
  }

  // Fetch up to MAX_LISTINGS_PER_EMAIL listings, newest first
  const rows = await db
    .select()
    .from(listings)
    .where(where)
    .orderBy(desc(listings.created_at))
    .limit(MAX_LISTINGS_PER_EMAIL);

  return { total, listings: rows };
}
