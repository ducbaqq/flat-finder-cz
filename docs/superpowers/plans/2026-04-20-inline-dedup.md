# Inline Incremental Deduplication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cluster new cross-source duplicates automatically at the end of each watch-mode scraper cycle, so new listings join existing clusters within minutes (not days).

**Architecture:** Smart-probe SQL pipeline: compute prospective `cluster_hash` for every unclustered active row, then probe `idx_listings_cluster_id` to either join an existing cluster or form a new one among matching candidates. Wrapped in a transaction with `SET LOCAL work_mem` + `statement_timeout`. Invoked from the watch loop after `printSummary()` and before `sleep()`. No schema change.

**Tech Stack:** TypeScript, Drizzle ORM + postgres-js, Playwright test runner (for structural mock tests).

**Spec:** [`docs/superpowers/specs/2026-04-20-inline-dedup-design.md`](../specs/2026-04-20-inline-dedup-design.md)

---

## File Plan

| File | Action | Responsibility |
|---|---|---|
| `packages/db/src/queries/listings.ts` | modify | Add `clusterNewListings()` — the smart-probe SQL pipeline |
| `apps/scraper/src/deactivator.ts` | modify | Add `clusterNewDuplicates()` logging wrapper |
| `apps/scraper/src/index.ts` | modify | Call wrapper after `printSummary()` in watch loop |
| `scripts/incremental-dedup.ts` | modify | Replace inline SQL with call to `clusterNewListings()` |
| `tests/clusterNewListings.spec.ts` | create | Structural mock-based unit tests (mirrors `clusterListings.spec.ts`) |

Return shape for the new function (matches the existing `clusterListings` pattern, with one extra breakdown field the script needs):

```ts
type IncrementalDedupResult = {
  clustered: number;         // total rows assigned a cluster_id
  clusters: number;          // distinct cluster_ids touched
  joined_existing: number;   // subset that joined a pre-existing cluster
};
```

---

## Task 1: Write failing test for the zero-work case

**Files:**
- Create: `tests/clusterNewListings.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/clusterNewListings.spec.ts
import { test, expect } from "@playwright/test";
import { clusterNewListings } from "../packages/db/src/queries/listings.js";
import type { Db } from "../packages/db/src/client.js";

/**
 * Structural mock tests — mirror the pattern used by clusterListings.spec.ts.
 * They verify clusterNewListings issues the expected sequence of execute()
 * calls and sums the returned rows correctly. They do NOT exercise the SQL
 * itself. Real SQL correctness is validated by running the script with
 * --apply against production data and spot-checking result rows.
 */
function makeMockDb(executeResults: unknown[][]) {
  const calls = { executes: [] as string[] };
  const resultQueue = [...executeResults];

  const db: Record<string, unknown> = {
    execute: async (query: unknown) => {
      calls.executes.push(String(query));
      return resultQueue.shift() ?? [];
    },
  };
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);

  return { db: db as unknown as Db, calls };
}

// Inside the transaction, clusterNewListings issues 3 execute() calls:
//   [0] SET LOCAL statement_timeout
//   [1] SET LOCAL work_mem
//   [2] the pipeline UPDATE ... RETURNING
const PRELUDE_LENGTH = 2;

test.describe("clusterNewListings", () => {
  test("returns zero counts when no candidates match", async () => {
    const { db, calls } = makeMockDb([
      [], // SET LOCAL statement_timeout
      [], // SET LOCAL work_mem
      [], // pipeline UPDATE RETURNING — no rows assigned
    ]);

    const result = await clusterNewListings(db);

    expect(result).toEqual({ clustered: 0, clusters: 0, joined_existing: 0 });
    expect(calls.executes).toHaveLength(PRELUDE_LENGTH + 1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx playwright test tests/clusterNewListings.spec.ts --reporter=list`
Expected: FAIL with a module-resolution or "clusterNewListings is not a function" error (because the function doesn't exist yet).

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/clusterNewListings.spec.ts
git commit -m "test: failing zero-work case for clusterNewListings"
```

---

## Task 2: Implement `clusterNewListings` skeleton to make Task 1 pass

**Files:**
- Modify: `packages/db/src/queries/listings.ts` — add function right after `runClusteringOps` (currently ends around line 415)

- [ ] **Step 1: Add the function at the end of the `clusterListings` + `runClusteringOps` block**

Insert after the closing `}` of `runClusteringOps` (the function ending just before `getClusterSiblings`):

```ts
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
  // 90s safety net — the watch loop sleeps for ~300s; we never want this
  // pass to hold locks past that. If the candidate pool ever grows large
  // enough to exceed 90s, that's the signal to introduce match_hash.
  await executor.execute(sql`SET LOCAL statement_timeout = '90s'`);
  // Match clusterListings for sort-in-memory headroom; the candidate pool
  // can reach six figures between daily full rebuilds.
  await executor.execute(sql`SET LOCAL work_mem = '256MB'`);

  const rows = (await executor.execute<{
    id: number;
    cluster_id: string;
    is_canonical: boolean;
    existing_cluster: boolean;
  }>(sql`
    WITH candidate_hashes AS (
      SELECT
        id,
        md5(
          'geo|' || transaction_type || '|' ||
          ROUND(latitude::numeric, 4)::text || '|' ||
          ROUND(longitude::numeric, 4)::text || '|' ||
          ROUND(size_m2::numeric, 2)::text || '|' ||
          ROUND(price::numeric, 0)::text
        ) AS prospective_hash
      FROM listings
      WHERE is_active = true
        AND cluster_id IS NULL
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND size_m2 IS NOT NULL AND price IS NOT NULL
    ),
    resolved AS (
      SELECT
        ch.id,
        ch.prospective_hash,
        EXISTS (
          SELECT 1 FROM listings l
          WHERE l.cluster_id = ch.prospective_hash
            AND l.is_active = true
        ) AS existing_cluster,
        COUNT(*) OVER (PARTITION BY ch.prospective_hash) AS hash_peers,
        MIN(ch.id) OVER (PARTITION BY ch.prospective_hash) AS new_canonical_id
      FROM candidate_hashes ch
    ),
    assignments AS (
      SELECT
        id,
        prospective_hash,
        existing_cluster,
        CASE
          WHEN existing_cluster THEN false
          ELSE (id = new_canonical_id)
        END AS new_is_canonical
      FROM resolved
      WHERE existing_cluster OR hash_peers > 1
    )
    UPDATE listings l
    SET
      cluster_id   = a.prospective_hash,
      is_canonical = a.new_is_canonical
    FROM assignments a
    WHERE l.id = a.id
    RETURNING l.id, l.cluster_id, l.is_canonical, a.existing_cluster
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx playwright test tests/clusterNewListings.spec.ts --reporter=list`
Expected: PASS (1 passed).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/queries/listings.ts
git commit -m "feat(db): clusterNewListings incremental smart-probe"
```

---

## Task 3: Test — rows joining an existing cluster count as `joined_existing`

**Files:**
- Modify: `tests/clusterNewListings.spec.ts`

- [ ] **Step 1: Add the test inside the existing `describe` block**

```ts
  test("counts joined_existing separately from new-cluster members", async () => {
    const returningRows = [
      // Two candidates joined an existing cluster "existing-hash"
      { id: 101, cluster_id: "existing-hash", is_canonical: false, existing_cluster: true },
      { id: 102, cluster_id: "existing-hash", is_canonical: false, existing_cluster: true },
      // Three candidates formed a new cluster "new-hash"
      { id: 201, cluster_id: "new-hash", is_canonical: true, existing_cluster: false },
      { id: 202, cluster_id: "new-hash", is_canonical: false, existing_cluster: false },
      { id: 203, cluster_id: "new-hash", is_canonical: false, existing_cluster: false },
    ];

    const { db } = makeMockDb([
      [], // SET LOCAL statement_timeout
      [], // SET LOCAL work_mem
      returningRows,
    ]);

    const result = await clusterNewListings(db);

    expect(result).toEqual({
      clustered: 5,
      clusters: 2,
      joined_existing: 2,
    });
  });
```

- [ ] **Step 2: Run tests to verify both pass**

Run: `npx playwright test tests/clusterNewListings.spec.ts --reporter=list`
Expected: PASS (2 passed).

- [ ] **Step 3: Commit**

```bash
git add tests/clusterNewListings.spec.ts
git commit -m "test: joined_existing vs new-cluster accounting"
```

---

## Task 4: Test — dry-run rolls back but still returns counts

**Files:**
- Modify: `tests/clusterNewListings.spec.ts`

- [ ] **Step 1: Add the test**

```ts
  test("dry-run rolls back via sentinel but still returns counts", async () => {
    const returningRows = [
      { id: 1, cluster_id: "h1", is_canonical: true, existing_cluster: false },
      { id: 2, cluster_id: "h1", is_canonical: false, existing_cluster: false },
    ];

    const { db } = makeMockDb([
      [], // SET LOCAL statement_timeout
      [], // SET LOCAL work_mem
      returningRows,
    ]);

    // Should not throw (sentinel DryRunRollback is caught), counts returned.
    const result = await clusterNewListings(db, { dryRun: true });

    expect(result).toEqual({ clustered: 2, clusters: 1, joined_existing: 0 });
  });
```

- [ ] **Step 2: Run tests — verify all three pass**

Run: `npx playwright test tests/clusterNewListings.spec.ts --reporter=list`
Expected: PASS (3 passed).

- [ ] **Step 3: Commit**

```bash
git add tests/clusterNewListings.spec.ts
git commit -m "test: dry-run rollback path returns counts"
```

---

## Task 5: Add `clusterNewDuplicates` logging wrapper

**Files:**
- Modify: `apps/scraper/src/deactivator.ts`

- [ ] **Step 1: Update the import to pull in the new function**

Replace line 2 (`import { deactivateStaleListings, deactivateByTtlListings, clusterListings } from "@flat-finder/db";`) with:

```ts
import { deactivateStaleListings, deactivateByTtlListings, clusterListings, clusterNewListings } from "@flat-finder/db";
```

- [ ] **Step 2: Append the wrapper at the end of the file**

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `npm -w packages/db run build`
Expected: no errors. This rebuilds the `@flat-finder/db` package so the new export is visible to the scraper. (If you skip this, the next build step will fail.)

Then: `npx tsc -p apps/scraper/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db apps/scraper/src/deactivator.ts
git commit -m "feat(scraper): clusterNewDuplicates wrapper for incremental dedup"
```

---

## Task 6: Hook incremental dedup into the watch loop

**Files:**
- Modify: `apps/scraper/src/index.ts`

- [ ] **Step 1: Update the import on line 45**

Current line 45:
```ts
import { deactivateStale, deactivateByTtl, clusterDuplicates } from "./deactivator.js";
```

Change to:
```ts
import { deactivateStale, deactivateByTtl, clusterDuplicates, clusterNewDuplicates } from "./deactivator.js";
```

- [ ] **Step 2: Add the call after `printSummary(results)` and the `shouldStop` guard**

Locate the watch-loop block (starts around line 1058 `while (!shouldStop) {`). The current end of the loop body around lines 1082–1087 reads:

```ts
      printSummary(results);

      if (shouldStop) break;

      console.log(`${ts()} [runner] Sleeping ${interval}s until next cycle...`);
      await sleep(interval * 1000);
```

Change to:

```ts
      printSummary(results);

      if (shouldStop) break;

      // Incremental dedup — cluster newly scraped rows against existing
      // clusters + each other. Failures are logged inside the wrapper and
      // do not interrupt the watch loop.
      if (!dryRun) {
        const conn = createDb();
        try {
          await clusterNewDuplicates(conn.db);
        } finally {
          await conn.sql.end();
        }
      }

      console.log(`${ts()} [runner] Sleeping ${interval}s until next cycle...`);
      await sleep(interval * 1000);
```

(The `createDb` + `conn.sql.end()` pattern matches the `--cleanup` / `--dedupe` branches already in this file. Fresh connection per cycle avoids leaking the shared-scraper pool.)

- [ ] **Step 3: Type-check**

Run: `npx tsc -p apps/scraper/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/scraper/src/index.ts
git commit -m "feat(scraper): call clusterNewDuplicates at end of each watch cycle"
```

---

## Task 7: Refactor `scripts/incremental-dedup.ts` to share the same function

**Files:**
- Modify: `scripts/incremental-dedup.ts`

- [ ] **Step 1: Replace the file contents**

```ts
/**
 * Benchmark + one-shot runner for incremental dedup.
 *
 * Shares the `clusterNewListings` implementation from @flat-finder/db with
 * the watch-loop hook, so this script's timing matches the inline pass.
 *
 * Dry-run by default. Pass --apply to persist.
 * Optional --hours=N narrows candidates via the scraped_at index (debug aid;
 * the in-loop pass never applies a window — it always considers the full
 * unclustered pool).
 *
 * Usage:
 *   npx tsx scripts/incremental-dedup.ts              # dry-run, full pool
 *   npx tsx scripts/incremental-dedup.ts --hours=120  # dry-run, past 5d only
 *   npx tsx scripts/incremental-dedup.ts --apply      # persist
 */
import { config } from "dotenv";
config();

import { createDb, clusterNewListings } from "@flat-finder/db";
import { sql } from "drizzle-orm";

function parseHours(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--hours="));
  if (!arg) return null;
  const n = Number(arg.slice("--hours=".length));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--hours must be a positive number, got: ${arg}`);
  }
  return n;
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const hours = parseHours();

  console.log(`Mode: ${apply ? "APPLY (will commit)" : "DRY RUN (rollback)"}`);
  console.log(`Window: ${hours == null ? "all unclustered" : `scraped_at within last ${hours}h`}`);

  const conn = createDb();
  try {
    // Optional windowed candidate count for context. The function itself
    // always scans the full unclustered pool; --hours only filters this
    // reporting query, so expect the assigned-row count to be the same
    // with or without --hours.
    if (hours != null) {
      const [row] = (await conn.db.execute<{ candidates: string }>(sql`
        SELECT COUNT(*)::text AS candidates
        FROM listings
        WHERE is_active = true
          AND cluster_id IS NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND size_m2 IS NOT NULL AND price IS NOT NULL
          AND scraped_at > now() - make_interval(hours => ${hours})
      `)) as { candidates: string }[];
      console.log(`Candidates in window (reporting only): ${row?.candidates ?? "?"}`);
    }

    const t0 = Date.now();
    const result = await clusterNewListings(conn.db, { dryRun: !apply });
    const elapsed = Date.now() - t0;

    console.log(`Rows updated: ${result.clustered}`);
    console.log(`  joined existing cluster: ${result.joined_existing}`);
    console.log(`  new-cluster members:     ${result.clustered - result.joined_existing}`);
    console.log(`  distinct clusters:       ${result.clusters}`);
    console.log(`\nPipeline: ${fmtMs(elapsed)}`);
    if (!apply) console.log("\n[dry-run] rolled back — no changes persisted.");
  } finally {
    await conn.sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against production to confirm parity**

Run: `npx tsx scripts/incremental-dedup.ts`
Expected: output shows `Rows updated:` close to the earlier smart-probe numbers (likely very few, since the 11:22 full rebuild is recent), and no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/incremental-dedup.ts
git commit -m "refactor(scripts): incremental-dedup shares clusterNewListings"
```

---

## Task 8: Manual production verification via `--apply`

**Files:** none (ops step — no code changes)

- [ ] **Step 1: Run the script with --apply against production**

Scraper should still be paused on the droplet (from earlier in the session). Local env points at the production DB.

Run: `npx tsx scripts/incremental-dedup.ts --apply`
Expected: output lists a small number of rows assigned (probably tens to low hundreds — mostly stragglers that appeared between the 11:22 full rebuild and now, plus any rows where rounding quirks caused the full pass to miss them).

- [ ] **Step 2: Spot-check two assigned rows**

Pick two IDs from the "Rows updated" batch (read them out of the script's stderr/stdout; or immediately after, query `SELECT id, source, source_url, cluster_id FROM listings WHERE cluster_id IS NOT NULL ORDER BY scraped_at DESC LIMIT 20`). Open both source URLs for any pair that share a cluster_id. Confirm they are genuinely the same apartment (same photos, same address, same price, same size).

Expected: at least one pair confirms as a true duplicate. If every "pair" looks like false positives, STOP — the SQL formula has drifted from the full pipeline and needs rechecking before proceeding.

- [ ] **Step 3: Record the result in the session**

No commit needed — paste the script output + your spot-check findings into chat so the next step has evidence.

---

## Task 9: Deploy to droplet and monitor 3 cycles

**Files:** none (ops step)

- [ ] **Step 1: Push all commits to origin**

```bash
git push origin main
```

- [ ] **Step 2: Pull + build + restart on droplet**

```bash
ssh root@167.172.176.70 'cd /root/flat-finder-cz && git pull && npm run build && pm2 restart api && pm2 start scraper'
```

Expected: `git pull` fast-forwards, `npm run build` succeeds, `pm2 list` shows api + web + scraper all online.

- [ ] **Step 3: Tail the scraper log for 3 full cycles**

```bash
ssh root@167.172.176.70 'pm2 logs scraper --lines 0'
```

Wait through 3 full watch cycles (~15 minutes at 300s interval).

Expected in each cycle:
- Summary table from the 10 sources (existing behavior)
- A new line: `[dedup-inc] N rows -> M clusters (X joined existing, Y new-cluster members) in Z ms`
  OR the zero-work variant: `[dedup-inc] No new clusters (Z ms)`
- Pipeline time `Z` stays under 60000 ms (60s). If it trends above 90s two cycles in a row, the statement timeout will fire and you'll see `[dedup-inc] FAILED after ... canceling statement due to statement timeout` — that's the signal to discuss the `match_hash` column follow-up.

- [ ] **Step 4: Sanity-check cluster growth**

After 3 cycles, from local:
```bash
npx tsx scripts/check-dedup-state.ts
```
Expected: `clustered` count has ticked up from the post-full-rebuild baseline (119,125 at 11:22), not by a huge amount but noticeably.

- [ ] **Step 5: Stop tailing, confirm stable**

Ctrl-C out of `pm2 logs`. No commit needed.

---

## Self-Review

**Spec coverage:**
- Goal (inline dedup after each cycle) → Task 6 ✓
- Non-goals (no schema change, no scraper changes, no clusterListings replacement) → plan respects all ✓
- Smart-probe algorithm → Task 2 SQL ✓
- Correctness invariants (late duplicates caught, canonical stable, idempotent) → Tasks 3, 4 + Task 8 manual verify ✓
- Architecture — new function, new wrapper, watch-loop hook, shared script → Tasks 2, 5, 6, 7 ✓
- Failure handling (try/catch, statement timeout) → Task 2 (timeout) + Task 5 (try/catch) ✓
- Performance (30–45s expected) → Task 9 step 3 monitors it ✓
- Daily full rebuild is a prereq → Not implemented here (it's already the midnight cron per the earlier ops step)
- Testing strategy (mock tests + manual verify + post-deploy check) → Tasks 1, 3, 4, 8, 9 ✓

**Placeholder scan:** No TBD/TODO/placeholders. All code blocks are complete.

**Type consistency:** Return shape `{ clustered, clusters, joined_existing }` used consistently across queries/listings.ts, tests, deactivator wrapper, and script.

**Gaps:** None found.
