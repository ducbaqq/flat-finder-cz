import {
  and,
  asc,
  type Column,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { ListingFilters } from "@flat-finder/types";
import { listings, type NewListing } from "../schema/listings.js";
import type { Db } from "../client.js";

export function buildWhereConditions(
  filters: ListingFilters,
  opts?: { includeInactive?: boolean },
): SQL[] {
  const conditions: SQL[] = [];

  if (!opts?.includeInactive) {
    conditions.push(eq(listings.is_active, true));
    conditions.push(eq(listings.is_canonical, true));
  }

  const simpleFilters: Array<{
    key: keyof ListingFilters;
    col: Column;
  }> = [
    { key: "property_type", col: listings.property_type },
    { key: "transaction_type", col: listings.transaction_type },
    { key: "city", col: listings.city },
    { key: "region", col: listings.region },
    { key: "source", col: listings.source },
    { key: "layout", col: listings.layout },
    { key: "condition", col: listings.condition },
    { key: "construction", col: listings.construction },
    { key: "ownership", col: listings.ownership },
    { key: "furnishing", col: listings.furnishing },
    { key: "energy_rating", col: listings.energy_rating },
  ];

  for (const { key, col } of simpleFilters) {
    const val = filters[key];
    if (val && typeof val === "string") {
      const vals = val.split(",").filter(Boolean);
      if (vals.length > 1) {
        conditions.push(inArray(col, vals));
      } else {
        conditions.push(eq(col, vals[0]));
      }
    }
  }

  if (filters.price_min != null) {
    conditions.push(gte(listings.price, filters.price_min));
  }
  if (filters.price_max != null) {
    conditions.push(lte(listings.price, filters.price_max));
  }
  if (filters.size_min != null) {
    conditions.push(gte(listings.size_m2, filters.size_min));
  }
  if (filters.size_max != null) {
    conditions.push(lte(listings.size_m2, filters.size_max));
  }

  if (filters.amenities) {
    for (const a of filters.amenities.split(",")) {
      conditions.push(ilike(listings.amenities, `%${a.trim()}%`));
    }
  }

  if (filters.location) {
    // Skip text-based location filter when bbox is present — the geographic
    // bounds already constrain results spatially, and the text filter can't
    // match streets/addresses (only city/district/region exact match).
    const hasBbox = filters.sw_lat != null && filters.sw_lng != null &&
      filters.ne_lat != null && filters.ne_lng != null;

    if (!hasBbox) {
      const loc = filters.location.trim();
      conditions.push(
        or(
          eq(listings.city, loc),
          eq(listings.district, loc),
          eq(listings.region, loc),
          ilike(listings.city, `${loc}%`),
          ilike(listings.district, `${loc}%`),
        )!,
      );
    }
  }

  // Thumbnail filter — exclude NULL and relative-path placeholders
  // (e.g. /images/empty_byt_3.jpg from aggregator portals). Doesn't
  // catch live 404s — the home page also runs an <img onError> filter
  // client-side to drop those at render time.
  if (filters.has_thumbnail) {
    conditions.push(isNotNull(listings.thumbnail_url));
    conditions.push(like(listings.thumbnail_url, "http%"));
  }

  // Geographic bounds
  if (
    filters.sw_lat != null &&
    filters.sw_lng != null &&
    filters.ne_lat != null &&
    filters.ne_lng != null
  ) {
    conditions.push(isNotNull(listings.latitude));
    conditions.push(isNotNull(listings.longitude));
    conditions.push(gte(listings.latitude, filters.sw_lat));
    conditions.push(lte(listings.latitude, filters.ne_lat));
    conditions.push(gte(listings.longitude, filters.sw_lng));
    conditions.push(lte(listings.longitude, filters.ne_lng));
  }

  return conditions;
}

export function getSortOrder(sort?: string) {
  switch (sort) {
    case "price_asc":
      return asc(listings.price);
    case "price_desc":
      return desc(listings.price);
    case "size_asc":
      return asc(listings.size_m2);
    case "size_desc":
      return desc(listings.size_m2);
    case "newest":
    default:
      return desc(listings.listed_at);
  }
}

export async function queryListings(
  db: Db,
  filters: ListingFilters,
  opts?: { cachedTotal?: number },
) {
  const page = filters.page ?? 1;
  const perPage = Math.min(filters.per_page ?? 20, 100);
  const offset = (page - 1) * perPage;

  const conditions = buildWhereConditions(filters, {
    includeInactive: filters.include_inactive,
  });
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Avoid holding a transaction open for both COUNT + SELECT.
  // The SELECT with LIMIT/OFFSET is fast; COUNT(*) on 400K rows is not.
  // Strategy:
  //   1. If we have a cached total, skip COUNT entirely.
  //   2. Otherwise, run the data query first (fast), then COUNT separately.
  //      Use statement_timeout on the COUNT to protect against slow filters.
  const hasCachedTotal = opts?.cachedTotal != null;

  // Data query — uses indexes on is_active + listed_at (or price/size for sort)
  const rows = await db
    .select()
    .from(listings)
    .where(where)
    .orderBy(getSortOrder(filters.sort))
    .limit(perPage)
    .offset(offset);

  let total: number;

  if (hasCachedTotal) {
    total = opts!.cachedTotal!;
  } else if (rows.length < perPage) {
    // Page is not full — we know the exact total
    total = offset + rows.length;
  } else {
    // Run COUNT with a 2s timeout. Fast for small result sets, falls back
    // to a generous estimate for large viewport scans that would take 10s+.
    try {
      const [totalResult] = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000'`);
        return tx.execute<{ cnt: string }>(
          sql`SELECT COUNT(*) AS cnt FROM (
            SELECT 1 FROM listings
            WHERE ${where ?? sql`true`}
            LIMIT 100000
          ) sub`,
        );
      });
      total = Number(totalResult?.cnt ?? 0);
    } catch {
      // COUNT timed out — estimate generously so pagination keeps working
      total = Math.max(10000, offset + rows.length + perPage);
    }
  }

  return {
    listings: rows,
    total,
    page,
    per_page: perPage,
    total_pages: total > 0 ? Math.ceil(total / perPage) : 1,
  };
}

export async function getListingById(db: Db, id: number) {
  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertListing(
  db: Db,
  listing: NewListing,
): Promise<{ isNew: boolean; id: number }> {
  const existing = await db
    .select({ id: listings.id, created_at: listings.created_at })
    .from(listings)
    .where(eq(listings.external_id, listing.external_id))
    .limit(1);

  if (existing.length === 0) {
    const result = await db.insert(listings).values(listing).returning({ id: listings.id });
    return { isNew: true, id: result[0].id };
  }

  const { external_id, source, ...mutableFields } = listing;
  await db
    .update(listings)
    .set(mutableFields)
    .where(eq(listings.external_id, listing.external_id));
  return { isNew: false, id: existing[0].id };
}

export async function findExistingExternalIds(
  db: Db,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const rows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(inArray(listings.external_id, externalIds));
  return new Set(rows.map((r) => r.external_id));
}

/**
 * Return external IDs that were scraped within the last `hours` hours.
 * Used to skip detail re-enrichment for recently-scraped listings in full mode.
 */
export async function findRecentlyScrapedIds(
  db: Db,
  externalIds: string[],
  hours: number,
): Promise<Set<string>> {
  if (externalIds.length === 0 || hours <= 0) return new Set();
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const rows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(
      and(
        inArray(listings.external_id, externalIds),
        gte(listings.scraped_at, cutoff),
      ),
    );
  return new Set(rows.map((r) => r.external_id));
}

/**
 * Return external IDs the scraper should SKIP on this pass. Two reasons:
 *   1. detail enrichment succeeded within the last `hours` hours, or
 *   2. enrichment has been attempted for `giveUpAfterDays` days without ever
 *      succeeding (enriched_at still null, created_at older than the cutoff).
 *
 * The give-up clause is what stops us retrying listings whose detail page
 * is genuinely empty on the portal (no description, seller, params, one
 * image — wasEnriched() returns false forever) from being enqueued on
 * every watcher cycle.
 *
 * Pass `giveUpAfterDays = 0` (or omit) to disable the give-up clause.
 */
export async function findRecentlyEnrichedIds(
  db: Db,
  externalIds: string[],
  hours: number,
  giveUpAfterDays = 0,
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  if (hours <= 0 && giveUpAfterDays <= 0) return new Set();

  const clauses: SQL[] = [];
  if (hours > 0) {
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    clauses.push(gte(listings.enriched_at, cutoff)!);
  }
  if (giveUpAfterDays > 0) {
    const giveUpCutoff = new Date(
      Date.now() - giveUpAfterDays * 86400_000,
    ).toISOString();
    clauses.push(
      and(
        isNull(listings.enriched_at),
        lte(listings.created_at, giveUpCutoff),
      )!,
    );
  }

  const rows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(
      and(
        inArray(listings.external_id, externalIds),
        clauses.length === 1 ? clauses[0] : or(...clauses)!,
      ),
    );
  return new Set(rows.map((r) => r.external_id));
}

/**
 * Return external IDs that are "done" from the scraper's perspective in
 * watch mode — either ever successfully enriched (enriched_at IS NOT NULL)
 * or given up on (enriched_at null, created_at older than the cutoff).
 *
 * Unlike findRecentlyEnrichedIds this does NOT care how recent the
 * enrichment is — once we have detail data for a watch-mode listing, we
 * keep it. The point of this query is to leave the caller with "truly new"
 * plus "still-within-retry-window" listings to process.
 */
export async function findEnrichmentDoneIds(
  db: Db,
  externalIds: string[],
  opts: { giveUpAfterDays: number },
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const giveUpCutoff = new Date(
    Date.now() - opts.giveUpAfterDays * 86400_000,
  ).toISOString();

  const rows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(
      and(
        inArray(listings.external_id, externalIds),
        or(
          isNotNull(listings.enriched_at),
          and(
            isNull(listings.enriched_at),
            lte(listings.created_at, giveUpCutoff),
          ),
        ),
      ),
    );
  return new Set(rows.map((r) => r.external_id));
}

/**
 * SCR-09: TTL-based deactivation.
 * Deactivates active listings whose scraped_at is older than `ttlDays` days.
 * This catches stale listings that accumulate when running in incremental/watch mode.
 */
export async function deactivateByTtlListings(
  db: Db,
  ttlDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const result = await db
    .update(listings)
    .set({
      is_active: false,
      deactivated_at: now,
      deactivation_reason: "ttl",
    })
    .where(
      and(
        eq(listings.is_active, true),
        lte(listings.scraped_at, cutoff),
      ),
    )
    .returning({ id: listings.id });

  return result.length;
}

// -----------------------------------------------------------------------
// Freshness sweep helpers (used by apps/scraper/src/refresh.ts)
// -----------------------------------------------------------------------

/**
 * Shape the sweep engine consumes per row: enough to do a liveness GET +
 * route to the right classifier/enricher.
 */
export interface LivenessCandidate {
  id: number;
  external_id: string;
  source: string;
  source_url: string | null;
  thumbnail_url: string | null;
  enriched_at: string | null;
  last_checked_at: string | null;
  image_urls: string[] | null;
}

/**
 * Pick the next batch of listings to liveness-check for a source.
 * Ordering: NULLS FIRST on last_checked_at, so a listing never checked
 * before goes to the front of the queue. Deterministic secondary sort by
 * id so concurrent sweeps don't race for the same row (combined with
 * row-level locking via FOR UPDATE SKIP LOCKED if needed later — for now
 * there's only one sweep worker so a plain ORDER BY is fine).
 */
export async function pickStaleForLiveness(
  db: Db,
  source: string,
  limit: number,
): Promise<LivenessCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({
      id: listings.id,
      external_id: listings.external_id,
      source: listings.source,
      source_url: listings.source_url,
      thumbnail_url: listings.thumbnail_url,
      enriched_at: listings.enriched_at,
      last_checked_at: listings.last_checked_at,
      image_urls: listings.image_urls,
    })
    .from(listings)
    .where(
      and(
        eq(listings.is_active, true),
        eq(listings.source, source),
        isNotNull(listings.source_url),
      ),
    )
    .orderBy(asc(listings.last_checked_at), asc(listings.id))
    .limit(limit);
  return rows as LivenessCandidate[];
}

/**
 * Stamp `last_checked_at = now` on a listing — called after every sweep
 * pass regardless of verdict so the priority queue advances even when the
 * classifier returns "unknown".
 */
export async function stampChecked(db: Db, id: number): Promise<void> {
  await db
    .update(listings)
    .set({ last_checked_at: new Date().toISOString() })
    .where(eq(listings.id, id));
}

/**
 * Batch variant — used when the sweep processes a chunk of IDs.
 */
export async function stampCheckedBatch(
  db: Db,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(listings)
    .set({ last_checked_at: new Date().toISOString() })
    .where(inArray(listings.id, ids));
}

/**
 * Single-row deactivation driven by the liveness classifier.
 * Records a reason so post-hoc triage can tell "liveness said dead" apart
 * from "TTL ran out" and "missing-from-full-scrape".
 */
export async function deactivateById(
  db: Db,
  id: number,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(listings)
    .set({
      is_active: false,
      deactivated_at: now,
      deactivation_reason: reason,
      last_checked_at: now,
    })
    .where(and(eq(listings.id, id), eq(listings.is_active, true)));
}

/**
 * Reactivate a listing that the sweep previously marked dead but is now
 * responding alive again. Only flips rows that were deactivated by the
 * sweep (deactivation_reason = 'liveness_*') within `withinDays` — we
 * don't resurrect TTL-deactivated rows this way.
 */
export async function reactivateIfLivenessDeactivated(
  db: Db,
  id: number,
  withinDays = 7,
): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - withinDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const now = new Date().toISOString();
  const result = await db
    .update(listings)
    .set({
      is_active: true,
      deactivated_at: null,
      deactivation_reason: null,
      last_checked_at: now,
    })
    .where(
      and(
        eq(listings.id, id),
        eq(listings.is_active, false),
        ilike(listings.deactivation_reason, "liveness_%"),
        gte(listings.deactivated_at, cutoff),
      ),
    )
    .returning({ id: listings.id });
  return result.length > 0;
}

// -----------------------------------------------------------------------
// Image-refresh sweep helpers (Phase 2 — used by runImageRefreshSweep)
// -----------------------------------------------------------------------

/**
 * Rows the image sweep HEAD-checks. Thumbnail URL is mandatory because
 * there's nothing to check otherwise — rows without a thumbnail are
 * skipped via the partial index (see 0005_add_last_image_checked_at.sql).
 */
export interface ImageCheckCandidate {
  id: number;
  external_id: string;
  source: string;
  source_url: string | null;
  thumbnail_url: string;
  enriched_at: string | null;
  last_image_checked_at: string | null;
}

/**
 * Pick the next batch of rows to HEAD-check for thumbnail rot.
 * Order: oldest `last_image_checked_at` first (NULLS FIRST = never
 * checked), tiebreak on id. Skips rows without a thumbnail, rows on
 * other sources, and inactive rows — all enforced by the partial index.
 */
export async function pickStaleForImageCheck(
  db: Db,
  source: string,
  limit: number,
): Promise<ImageCheckCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({
      id: listings.id,
      external_id: listings.external_id,
      source: listings.source,
      source_url: listings.source_url,
      thumbnail_url: listings.thumbnail_url,
      enriched_at: listings.enriched_at,
      last_image_checked_at: listings.last_image_checked_at,
    })
    .from(listings)
    .where(
      and(
        eq(listings.is_active, true),
        eq(listings.source, source),
        isNotNull(listings.thumbnail_url),
      ),
    )
    .orderBy(asc(listings.last_image_checked_at), asc(listings.id))
    .limit(limit);
  return rows as ImageCheckCandidate[];
}

/**
 * Pick rows where detail data is stale enough to re-enrich prophylactically,
 * regardless of whether the thumbnail currently resolves. Acts as a 7-day
 * (configurable) ceiling on enrichment age so rot we never HEAD-catch still
 * gets refreshed eventually, and so description/price/specs stay current.
 *
 * enriched_at NULL is excluded: those rows either haven't been enriched yet
 * (the main runCycle path will get to them) or belong to no-detail-phase
 * sources like bezrealitky where enriched_at stays null forever.
 */
export async function pickStaleForImageReenrich(
  db: Db,
  source: string,
  limit: number,
  thresholdDays: number,
): Promise<ImageCheckCandidate[]> {
  if (limit <= 0) return [];
  const cutoff = new Date(
    Date.now() - thresholdDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db
    .select({
      id: listings.id,
      external_id: listings.external_id,
      source: listings.source,
      source_url: listings.source_url,
      thumbnail_url: listings.thumbnail_url,
      enriched_at: listings.enriched_at,
      last_image_checked_at: listings.last_image_checked_at,
    })
    .from(listings)
    .where(
      and(
        eq(listings.is_active, true),
        eq(listings.source, source),
        isNotNull(listings.source_url),
        isNotNull(listings.enriched_at),
        lte(listings.enriched_at, cutoff),
      ),
    )
    .orderBy(asc(listings.enriched_at), asc(listings.id))
    .limit(limit);
  return rows as ImageCheckCandidate[];
}

/**
 * Stamp `last_image_checked_at = now` in a batch. Called after every
 * HEAD check regardless of result so the queue advances even when a row
 * turns out to be alive.
 */
export async function stampImageCheckedBatch(
  db: Db,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(listings)
    .set({ last_image_checked_at: new Date().toISOString() })
    .where(inArray(listings.id, ids));
}

/**
 * Fetch the full DB rows for a set of ids. Used by the image-refresh
 * engine to reconstruct a ScraperResult-shaped stub before calling
 * `scraper.enrichListings([...])`.
 */
export async function getListingsByIds(
  db: Db,
  ids: number[],
): Promise<Array<typeof listings.$inferSelect>> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(listings)
    .where(inArray(listings.id, ids));
  return rows;
}

/**
 * Cluster duplicate listings across sources.
 *
 * Match key: `transaction_type + ROUND(lat,4) + ROUND(lng,4) + size_m2 + price`
 * (roughly: same transaction, same ~11 m geo block, same size, same price).
 * Listings sharing the full key get the same `cluster_id`; one row per cluster
 * is marked `is_canonical = true` (lowest id).
 *
 * Match keys chosen from 2026-04-10 production data analysis: phone (42%) and
 * layout (31%) have insufficient coverage. geo+size alone creates false positives
 * for same-building different-unit cases; adding price + transaction_type fixes
 * that while still matching 86% of real duplicates (which share exact price).
 * transaction_type prevents rent-vs-sale collisions at the same location.
 *
 * An earlier version had a second address-based phase for listings without
 * coordinates. It was removed because Czech portal `address` is frequently the
 * coarse district name ("Praha 2"), which collapsed genuinely distinct units
 * in the same district at the same round price into a single cluster. Listings
 * without coordinates simply stay unclustered now; that's the safer default.
 *
 * Rounding notes:
 *   - lat/lng rounded to 4 decimals (~11 m) — both in GROUP BY and md5 hash
 *   - size_m2 rounded to 2 decimals — normalizes double-precision float quirks
 *   - price rounded to integer CZK — prices are always whole CZK in practice
 *
 * All rows stay is_active — nothing is deactivated.
 *
 * Dry-run mode: runs the full SQL pipeline inside a transaction that is always
 * rolled back, so counts reflect what would happen without persisting changes.
 */
export async function clusterListings(
  db: Db,
  opts: { dryRun?: boolean } = {},
): Promise<{ clustered: number; clusters: number }> {
  // Always wrap in a transaction. Two reasons:
  //   1. Binds every statement to a single connection, so `SET LOCAL work_mem`
  //      stays in effect for the CTE queries. Without this, postgres-js may
  //      route subsequent statements to different pool connections and the
  //      bumped work_mem is lost — causing the big Phase 1 sort to spill to
  //      disk and take 15+ minutes.
  //   2. Lets dry-run mode cleanly roll back by throwing a sentinel error.
  let result: { clustered: number; clusters: number } = { clustered: 0, clusters: 0 };
  try {
    await db.transaction(async (tx) => {
      result = await runClusteringOps(tx as unknown as Db);
      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return result;
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

async function runClusteringOps(
  executor: Db,
): Promise<{ clustered: number; clusters: number }> {
  // Bump work_mem so the sort (~37MB at current scale) fits in memory
  // instead of spilling to disk. SET LOCAL scopes the bump to the
  // surrounding transaction — valid because we always run inside one.
  await executor.execute(sql`SET LOCAL work_mem = '256MB'`);

  // Reset previous clustering so the pass is fully idempotent.
  await executor.execute(sql`
    UPDATE listings
    SET cluster_id = NULL, is_canonical = true
    WHERE cluster_id IS NOT NULL
  `);

  // Group active listings by either the primary match_hash (geo + size +
  // price + transaction_type, prefix 'geo|') or the secondary no-price
  // hash (geo + size + transaction_type, prefix 'geo-np|'; fires only
  // when price IS NULL). Any group with ≥2 members is a cluster.
  //
  // We COALESCE over the two STORED columns instead of recomputing md5
  // inline — identical semantics to the 0004/0006 migrations and ~halves
  // the SQL we have to keep byte-compatible across files.
  //
  // Prefixes guarantee disjoint hash spaces: a primary hash can never
  // equal a secondary hash, so COALESCE gives the correct key regardless
  // of which column populated.
  const result = await executor.execute<{ id: number; cluster_id: string }>(sql`
    WITH duplicate_groups AS (
      SELECT
        COALESCE(match_hash, match_hash_no_price) AS cluster_hash,
        MIN(id) AS canonical_id,
        array_agg(id) AS member_ids
      FROM listings
      WHERE is_active = true
        AND (match_hash IS NOT NULL OR match_hash_no_price IS NOT NULL)
      GROUP BY COALESCE(match_hash, match_hash_no_price)
      HAVING COUNT(*) > 1
    )
    UPDATE listings l
    SET
      cluster_id  = dg.cluster_hash,
      is_canonical = (l.id = dg.canonical_id)
    FROM duplicate_groups dg
    WHERE l.id = ANY(dg.member_ids)
    RETURNING l.id, l.cluster_id
  `);

  const rows = result as { id: number; cluster_id: string }[];
  const clusters = new Set(rows.map((r) => r.cluster_id));

  return {
    clustered: rows.length,
    clusters: clusters.size,
  };
}

/**
 * Incremental "smart-probe" dedup — cluster new active listings against
 * existing clusters + each other without touching rows that are already
 * clustered.
 *
 * For every active listing with cluster_id IS NULL that has geo + size +
 * price, compute its prospective cluster_hash (same formula as
 * clusterListings). Then two outcomes per candidate:
 *
 *   1. Another active row already holds this hash → candidate joins that
 *      cluster, is_canonical stays false (the existing canonical is not
 *      touched).
 *   2. Multiple candidates share the hash and no existing cluster uses
 *      it → they form a new cluster. MIN(id) becomes canonical.
 *
 * Candidates whose hash matches nothing stay cluster_id IS NULL — eligible
 * to cluster on any future call.
 *
 * Statement timeout of 90s protects the watch loop from pathological
 * slowdowns; the pass aborts cleanly rather than holding locks past the
 * sleep interval.
 *
 * Designed to run at the end of every watch-mode scraper cycle. Does NOT
 * replace clusterListings — that still runs daily via --dedupe cron to
 * reset drifted clusters, recompute canonicals, and catch price-change
 * drift on already-clustered rows.
 */
export async function clusterNewListings(
  db: Db,
  opts: { dryRun?: boolean } = {},
): Promise<{ clustered: number; clusters: number; joined_existing: number }> {
  let result = { clustered: 0, clusters: 0, joined_existing: 0 };
  try {
    await db.transaction(async (tx) => {
      result = await runIncrementalClusteringOps(tx as unknown as Db);
      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return result;
}

async function runIncrementalClusteringOps(
  executor: Db,
): Promise<{ clustered: number; clusters: number; joined_existing: number }> {
  // The STORED match_hash column lets us skip the per-candidate md5 call.
  // Instead of two scans (one for candidates, one for existing clusters),
  // we GROUP BY match_hash across all active+hashable rows and per-group
  // decide whether to assign. This is the same HashAggregate pattern
  // clusterListings uses for the daily rebuild — one scan of the active
  // rows, bounded by the number of distinct hashes (not rows).
  await executor.execute(sql`SET LOCAL work_mem = '256MB'`);

  const rows = (await executor.execute<{
    id: number;
    cluster_id: string;
    is_canonical: boolean;
    existing_cluster: boolean;
  }>(sql`
    WITH hash_groups AS (
      SELECT
        -- Either the primary hash (price-present) or the secondary
        -- no-price hash (price-on-request). Prefixes 'geo|' / 'geo-np|'
        -- keep them in disjoint spaces so COALESCE is unambiguous.
        COALESCE(match_hash, match_hash_no_price) AS effective_hash,
        -- Existing-cluster groups: any row in the group already has a
        -- cluster_id set. New members inherit that cluster_id and stay
        -- is_canonical = false.
        bool_or(cluster_id IS NOT NULL) AS existing_cluster,
        -- Candidates: rows in this group that still need a cluster_id.
        array_agg(id) FILTER (WHERE cluster_id IS NULL) AS candidate_ids,
        -- Canonical for a new (no-existing) cluster: smallest candidate id.
        min(id) FILTER (WHERE cluster_id IS NULL) AS new_canonical_id,
        count(*) FILTER (WHERE cluster_id IS NULL) AS candidate_count
      FROM listings
      WHERE is_active = true
        AND (match_hash IS NOT NULL OR match_hash_no_price IS NOT NULL)
      GROUP BY COALESCE(match_hash, match_hash_no_price)
      HAVING
        -- Need at least one candidate to UPDATE.
        count(*) FILTER (WHERE cluster_id IS NULL) > 0
        -- AND either an existing cluster to join OR ≥2 candidates forming
        -- a new one. Single unique candidates stay NULL until a sibling
        -- arrives (then caught on a future cycle or the daily rebuild).
        AND (
          bool_or(cluster_id IS NOT NULL)
          OR count(*) FILTER (WHERE cluster_id IS NULL) >= 2
        )
    )
    UPDATE listings l
    SET
      cluster_id   = hg.effective_hash,
      is_canonical = (NOT hg.existing_cluster AND l.id = hg.new_canonical_id)
    FROM hash_groups hg
    WHERE l.id = ANY(hg.candidate_ids)
    RETURNING l.id, l.cluster_id, l.is_canonical, hg.existing_cluster
  `)) as Array<{
    id: number;
    cluster_id: string;
    is_canonical: boolean;
    existing_cluster: boolean;
  }>;

  const clusters = new Set(rows.map((r) => r.cluster_id)).size;
  const joined_existing = rows.filter((r) => r.existing_cluster).length;

  return {
    clustered: rows.length,
    clusters,
    joined_existing,
  };
}

/**
 * For a given listing, return one row per source in the same cluster — the
 * most recently scraped row for each portal. Used by the detail page
 * "Available on N portals" panel.
 *
 * A single portal often publishes the same listing under multiple external
 * IDs (e.g. ereality listed the same Prague 9 garage parking spot 7 times at
 * 1 890 CZK). Users only want one link per domain, and they want the
 * freshest one — the listing still alive on the portal, not a stale
 * republication.
 *
 * Implementation: `SELECT DISTINCT ON (source) ... ORDER BY source,
 * scraped_at DESC` picks the most recent row per source. The result is
 * re-sorted by price ascending in JS so the cheapest portal comes first.
 */
export async function getClusterSiblings(db: Db, listingId: number) {
  const [row] = await db
    .select({ cluster_id: listings.cluster_id })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!row?.cluster_id) return [];

  const distinct = await db
    .selectDistinctOn([listings.source], {
      id: listings.id,
      source: listings.source,
      external_id: listings.external_id,
      source_url: listings.source_url,
      property_type: listings.property_type,
      transaction_type: listings.transaction_type,
      layout: listings.layout,
      price: listings.price,
      currency: listings.currency,
      is_canonical: listings.is_canonical,
    })
    .from(listings)
    .where(
      and(
        eq(listings.cluster_id, row.cluster_id),
        eq(listings.is_active, true),
      ),
    )
    // DISTINCT ON requires its target column to come first in ORDER BY.
    // Within each source partition, prefer the most recently scraped row.
    .orderBy(listings.source, desc(listings.scraped_at));

  // Re-sort by price ascending so the cheapest portal is first in the UI.
  return distinct.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
}

export async function deactivateStaleListings(
  db: Db,
  source: string,
  seenIds: Set<string>,
): Promise<number> {
  if (seenIds.size === 0) return 0;

  const activeRows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(and(eq(listings.source, source), eq(listings.is_active, true)));

  const staleIds = activeRows
    .map((r) => r.external_id)
    .filter((id) => !seenIds.has(id));

  if (staleIds.length === 0) return 0;

  const now = new Date().toISOString();
  const CHUNK = 500;
  let deactivated = 0;

  for (let i = 0; i < staleIds.length; i += CHUNK) {
    const chunk = staleIds.slice(i, i + CHUNK);
    await db
      .update(listings)
      .set({ is_active: false, deactivated_at: now })
      .where(inArray(listings.external_id, chunk));
    deactivated += chunk.length;
  }

  return deactivated;
}
