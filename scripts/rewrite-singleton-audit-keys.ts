/**
 * Rewrite stale `singleton:<listing_id>` audit keys in
 * `watchdog_notifications` to the canonical `cluster:<cluster_id>` key once
 * the underlying listing has been clustered by `--dedupe`.
 *
 * Why: Hlídač uses `cluster_key` as the dedup token across notification
 * sends. When a listing first appears it has no cluster_id yet, so we
 * record the audit row with `singleton:<listing_id>`. After the nightly
 * `--dedupe` pass clusters that listing with siblings on other portals,
 * the audit row's key would no longer match new sends from siblings —
 * which would re-notify the user about the same property. Rewriting the
 * key here closes that gap.
 *
 * Idempotent: running twice updates 0 rows the second time (the WHERE
 * clause requires `cluster_key='singleton:<id>'`, which the first run
 * already replaced).
 *
 * Usage:
 *   npx tsx scripts/rewrite-singleton-audit-keys.ts
 *
 * Pattern mirrors scripts/incremental-dedup.ts — @flat-finder/config loads
 * .env at module init via @flat-finder/db, so no explicit dotenv call.
 */
import { createDb } from "@flat-finder/db";
import { sql } from "drizzle-orm";

async function main() {
  const conn = createDb();
  try {
    const t0 = Date.now();
    const result = await conn.db.execute(sql`
      UPDATE watchdog_notifications wn
      SET cluster_key = 'cluster:' || l.cluster_id
      FROM listings l
      WHERE wn.cluster_key = 'singleton:' || l.id::text
        AND l.cluster_id IS NOT NULL
    `);
    const elapsed = Date.now() - t0;

    // postgres-js / drizzle returns either { count } or { rowCount } depending
    // on driver path; accept both.
    const updated =
      (result as { count?: number; rowCount?: number }).count ??
      (result as { count?: number; rowCount?: number }).rowCount ??
      0;

    console.log(
      `Rewrote ${updated} singleton audit keys to cluster keys (${elapsed} ms)`,
    );
  } finally {
    await conn.sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
