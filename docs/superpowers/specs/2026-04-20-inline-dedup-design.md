# Inline Incremental Deduplication — Design

**Date:** 2026-04-20
**Status:** approved, ready for implementation plan

## Goal

Run cross-source duplicate clustering automatically at the end of every watch-mode scraper cycle, so new listings are grouped with their existing duplicates within minutes of being scraped — without waiting for the weekly full `--dedupe` rebuild.

## Non-Goals

- Replace the existing `clusterListings()` full-pipeline rebuild. That stays as the nightly safety net (`npm run scraper -- --dedupe`).
- Re-cluster previously-clustered rows on price changes or other edits. The daily full rebuild handles that drift.
- Any schema change (no `match_hash` column, no `dedup_checked_at` column). This design is deliberately zero-migration.
- Change how canonical is chosen inside an existing cluster (we always leave the existing canonical alone and join as non-canonical).

## Approach — "Smart Probe"

On every watch cycle, after all 10 sources finish scraping and summary prints, run an incremental pass:

1. **Candidates** = active listings with `cluster_id IS NULL` that have all match-key fields populated (`latitude`, `longitude`, `size_m2`, `price` not null).
2. For each candidate, compute its prospective `cluster_hash` using the same formula as the full pipeline:
   `md5('geo|' || transaction_type || '|' || ROUND(lat,4) || '|' || ROUND(lng,4) || '|' || ROUND(size_m2,2) || '|' || ROUND(price,0))`
3. Resolve each candidate against two possible outcomes:
    - **Case A — join existing cluster:** `EXISTS (SELECT 1 FROM listings WHERE cluster_id = candidate.hash AND is_active = true)` returns true. Candidate gets that `cluster_id`, `is_canonical = false`. The existing canonical is not touched.
    - **Case B — form new cluster among candidates:** two or more candidates share the same hash AND no existing cluster holds that hash. They all get the hash as their `cluster_id`; the one with `MIN(id)` becomes `is_canonical = true`, the others `is_canonical = false`.
4. Candidates whose hash matches nothing stay `cluster_id IS NULL` — eligible to cluster on any future cycle.

The SQL is one statement wrapped in a transaction with `SET LOCAL work_mem = '256MB'`, identical to the shape already benchmarked in `scripts/incremental-dedup.ts`.

## Correctness Invariants

1. **Late duplicates are caught.** If row A is scraped on day 1 (stays NULL, no match) and row B scraped on day 4 (also NULL at that moment), the day-4 cycle groups them because both are still candidates.
2. **Even-later duplicates are caught.** If row C is scraped on day 8 and hashes identically to the A+B cluster, C finds that cluster via the `EXISTS` probe and joins — regardless of age.
3. **No re-clustering of already-clustered rows.** Rows with `cluster_id IS NOT NULL` are skipped. This means a price drop on an existing clustered row that would newly match a different cluster is NOT handled inline — only the daily full rebuild catches this drift. Documented as an accepted limitation.
4. **Idempotent.** Running the pass twice in a row with no new scraper activity produces the same result on the second run (0 updates).
5. **Canonical is stable within a cluster.** Once a row is canonical, it stays canonical across inline passes. Only the full rebuild can reassign canonicity.

## Architecture

### New code location

- **New exported function** in `packages/db/src/queries/listings.ts`: `clusterNewListings(db): Promise<{ assigned: number, joined_existing: number, new_clusters: number }>` — contains the SQL pipeline.
- **New wrapper** in `apps/scraper/src/deactivator.ts`: `clusterNewDuplicates(db)` — thin wrapper matching the style of existing `clusterDuplicates()` that handles logging and returns the counts.
- **Watch-loop hook** in `apps/scraper/src/index.ts`: after `printSummary(results)` and before `sleep(interval * 1000)`, call the new wrapper. Wrap in try/catch so a failure logs but does not kill the watch loop.
- **Standalone script** `scripts/incremental-dedup.ts` (already exists from the benchmark) stays as an ops tool. Update it to call the new `clusterNewListings()` so both paths share one code definition.

### Not touched

- `clusterListings()` (the full pipeline) — unchanged.
- `--dedupe` CLI flag — unchanged, still invokes the full pipeline.
- Schema — no migrations.
- Scrapers — no changes. They continue to upsert with `cluster_id = NULL` on new rows.

## Failure Handling

- The inline pass runs inside a single transaction. If the UPDATE errors (lock contention, statement timeout, connection drop), Postgres rolls back and the watch cycle continues.
- The wrapper logs the error with `[runner]` prefix and continues. No alert on a single failure — the next cycle retries in 5 minutes. (Future improvement: count consecutive failures and alert after N, but not v1.)
- A statement timeout safety net: set `SET LOCAL statement_timeout = '90s'` at the top of the transaction. If the pipeline ever slows down past that (e.g., candidate pool grows unbounded because the full rebuild hasn't run), the inline pass aborts rather than holding locks through the whole sleep interval.

## Performance Expectations

From benchmarking on production data (2026-04-20):

| Candidate pool | Pipeline time |
|---|---|
| 167K (full scan, no window) | ~87s |
| ~900 (past 6h window — scraper-paused baseline) | ~32s |

Most of the cost is the `EXISTS` probe per candidate against `idx_listings_cluster_id`, not row-count-dependent. So expect **30–45s per cycle** in steady state. Comfortably within the 300s watch interval (scraper cycle itself is 1–2 min; combined cycle 2–4 min total).

Performance will slowly grow as the still-unclustered pool grows between daily rebuilds, bounded by the daily reset. If pipeline time exceeds ~90s consistently, that's the signal to introduce the `match_hash` column optimization (explicitly out of scope for this design).

## Operational Considerations

- **Weekly full rebuild is a prerequisite, not part of this design.** The inline pass only clusters rows that were `NULL` at probe time; it does not reset or reorganize existing clusters. Price drift, geo corrections, canonical rotation all depend on the periodic full pipeline. The daily `--dedupe` cron is chained into the existing midnight `--full` cron on the droplet (per the runbook in the `listing-deduplication` project note). Without it, the inline pass still works correctly but gradually accumulates drift.
- **No cache-warming needed after inline passes.** The inline UPDATE touches ≤100 rows per cycle — a rounding error against the working set. The cache eviction problem only applies to the full rebuild (~300K row touches).
- **Dedupe cron runbook does not change.** Full `--dedupe` still requires pausing the scraper, because it takes a single transaction lock across ~300K rows for ~20+ minutes. The inline pass is fundamentally different: sub-minute, touches tens of rows, interleaves safely with the scraper's own upserts.

## Testing Strategy

Match the existing project convention: mock-based unit tests + manual integration verification. Integration tests against a real seeded Postgres are a known follow-up (flagged in `listing-deduplication` notes as v2) — out of scope here.

- **Unit test** (`tests/clusterNewListings.spec.ts`) — mock-based, following the style of the existing `tests/clusterListings.spec.ts`. Verifies:
    - The SQL pipeline executes the expected statements in order
    - Dry-run / apply branches are wired correctly
    - Counts are returned in the documented shape
    (Caveat: same as the existing dedup tests, mocks don't exercise real SQL semantics.)
- **Manual integration verification** before merging: run `npx tsx scripts/incremental-dedup.ts --apply --hours=6` against production, spot-check two or three assigned rows in the DB, confirm they actually belong to the same real apartment (open both source URLs).
- **Post-deploy verification** on the droplet: tail `pm2 logs scraper` for three cycles, confirm the new `[dedup] ...` lines appear with reasonable timing, confirm no transaction errors.

## Rollout

1. Merge and deploy to droplet.
2. Watch first 2–3 cycles via `pm2 logs scraper` — confirm pipeline timing stays under 60s, no transaction errors.
3. Query `SELECT COUNT(*) FILTER (WHERE cluster_id IS NOT NULL) FROM listings WHERE is_active = true` over the next day — should trend up gradually instead of only jumping after the daily full rebuild.
4. If pipeline time creeps above 90s, schedule the `match_hash` follow-up.

## Open Questions

None. Smart-probe approach validated against the day-1/day-4/day-8 scenario; benchmark confirms workable timing; integration points identified.
