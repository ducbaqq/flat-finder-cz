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
  /** Up to 10 listings, newest first — what the email actually displays. */
  listings: ListingRow[];
  /** Real total of distinct listings matching the watchdog (un-capped). */
  totalCount: number;
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
 * Returns up to 10 listings for display PLUS the un-capped total count
 * via a separate COUNT(*). The headline copy ("X nových nabídek
 * odpovídá tvému hledání") needs the real total, not the displayed
 * subset, and the "Zobrazit na Bytomat.cz" CTA threshold is total > 10.
 *
 * Two queries instead of one, but each smaller (LIMIT 10 vs LIMIT 21).
 * COUNT can stop early via the planner anyway when the total is small.
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
    // 1) Listings to display — capped at 10 for the email body.
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
      LIMIT 10
    `);

    // postgres-js's tx.execute returns the rows array directly. Some
    // drivers wrap it in `{ rows }` — guard against that defensively.
    const rows: ListingRow[] = Array.isArray(result)
      ? (result as ListingRow[])
      : ((result as unknown as { rows?: ListingRow[] }).rows ?? []);

    // Short-circuit: if we got fewer than the LIMIT, that IS the total.
    // No COUNT query needed — saves a round-trip on the common case
    // where a watchdog has 0–9 new matches per cycle.
    if (rows.length < 10) {
      return { listings: rows, totalCount: rows.length };
    }

    // 2) We hit the LIMIT, so there might be more. Pull the real total.
    const countResult = await tx.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${listings}
      LEFT JOIN watchdog_notifications wn
        ON wn.email_canonical = ${watchdog.email_canonical}
       AND wn.cluster_key = COALESCE(
             'cluster:' || ${listings}.cluster_id,
             'singleton:' || ${listings}.id::text
           )
      WHERE ${whereExpr}
        AND wn.cluster_key IS NULL
    `);
    const countRows = Array.isArray(countResult)
      ? (countResult as { count: number }[])
      : ((countResult as unknown as { rows?: { count: number }[] }).rows ?? []);
    const totalCount = Number(countRows[0]?.count ?? rows.length);

    return { listings: rows, totalCount };
  });
}
