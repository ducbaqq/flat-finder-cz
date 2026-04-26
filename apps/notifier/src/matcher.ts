import { and, gt, sql } from "drizzle-orm";
import {
  type Db,
  listings,
  type ListingRow,
  buildWhereConditions,
} from "@flat-finder/db";
import type { ListingFilters } from "@flat-finder/types";
import type { WatchdogRow } from "@flat-finder/db";

export interface MatchResult {
  /** Up to 20 listings, newest first. */
  listings: ListingRow[];
  /** True if the underlying LIMIT 21 query came back full (>20 candidates). */
  hasMore: boolean;
}

/**
 * Find listings matching a watchdog's filters that:
 *
 *   1. were created after the cutoff (perf prefilter — last_notified_at
 *      or created_at), AND
 *   2. have NOT yet been emailed to this canonical email (anti-join on
 *      `watchdog_notifications.cluster_key`, which is the actual
 *      correctness boundary — re-clustering and cross-portal duplicates
 *      collapse to the same key).
 *
 * Single round-trip with `LIMIT 21` so the worker can answer "are there
 * more than 20 matches?" without a separate COUNT query.
 *
 * Wraps in a transaction with a 3s `statement_timeout` so a pathological
 * filter (regex on amenities, etc.) can't take down the whole cycle —
 * mirrors the pattern at packages/db/src/queries/listings.ts:177-186.
 */
export async function findMatchingListings(
  db: Db,
  watchdog: WatchdogRow,
): Promise<MatchResult> {
  const cutoff =
    watchdog.last_notified_at ??
    watchdog.created_at ??
    "1970-01-01 00:00:00";

  const filters: ListingFilters =
    (watchdog.filters as ListingFilters | null) ?? {};

  // buildWhereConditions enforces is_active = true AND is_canonical = true.
  // Cluster_key dedup handles cross-portal duplicates fully; we still email
  // canonical rows only so the link target is the chosen primary listing.
  const baseConditions = buildWhereConditions(filters);
  const whereExpr = and(...baseConditions, gt(listings.created_at, cutoff))!;

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '3000'`);

    // Drizzle exposes the underlying table reference via `${listings}` so
    // the query planner can still pick our composite indexes. The
    // anti-join expression COALESCEs cluster_id → singleton fallback so a
    // listing without a cluster still dedups against itself.
    //
    // NOTE: do NOT alias `listings` as `l` here. `buildWhereConditions`
    // emits column references qualified with the unaliased table name
    // (`"listings"."is_active"` etc.), and Postgres takes the alias as
    // a hard rename — under `FROM "listings" l`, "listings"."col" is
    // out of scope and the query throws. Reference the table by its
    // unaliased name end-to-end.
    const result = await tx.execute<ListingRow>(sql`
      SELECT ${listings}.*
      FROM ${listings}
      LEFT JOIN watchdog_notifications wn
        ON wn.email_canonical = ${watchdog.email_canonical}
       AND wn.cluster_key = COALESCE(
             'cluster:' || ${listings}.cluster_id,
             'singleton:' || ${listings}.id::text
           )
      WHERE ${whereExpr}
        AND wn.cluster_key IS NULL
      ORDER BY ${listings}.created_at DESC
      LIMIT 21
    `);

    // postgres-js's tx.execute returns the rows array directly. Some
    // drivers wrap it in `{ rows }` — guard against that defensively.
    const rows: ListingRow[] = Array.isArray(result)
      ? (result as ListingRow[])
      : ((result as unknown as { rows?: ListingRow[] }).rows ?? []);

    const hasMore = rows.length > 20;
    return {
      listings: hasMore ? rows.slice(0, 20) : rows,
      hasMore,
    };
  });
}
