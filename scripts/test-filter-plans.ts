/**
 * Run EXPLAIN on each single-filter query that buildWhereConditions would
 * generate, and report which index the planner actually picked.
 *
 * This is the decisive test for the index pruning PR: if the planner
 * never picks `idx_listings_city` for any realistic filter, it's safe
 * to drop. If it DOES pick it, dropping would regress that query's plan.
 *
 * Uses EXPLAIN (not EXPLAIN ANALYZE) so nothing actually runs against
 * the DB beyond the planning phase — no I/O, no cache impact.
 *
 * Usage: npx tsx scripts/test-filter-plans.ts
 */
import { config } from "dotenv";
config();

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function connect() {
  const username = process.env.DB_USERNAME ?? "flat_finder";
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const database = process.env.DB_DATABASE ?? "reality-app";
  const url = `postgres://${username}:${password}@${host}:${port}/${database}`;

  const caPath = path.resolve(process.cwd(), "certs/ca-certificate.crt");
  const ssl =
    process.env.DB_SSLMODE === "disable"
      ? false
      : fs.existsSync(caPath)
        ? { ca: fs.readFileSync(caPath, "utf-8"), rejectUnauthorized: true }
        : { rejectUnauthorized: false };

  return postgres(url, { ssl, max: 1, connect_timeout: 15 });
}

/**
 * Every buildWhereConditions() output adds `is_active = true AND
 * is_canonical = true` automatically, so the test queries do too. This
 * mirrors the real API path.
 */
type Scenario = { name: string; sql: string };

const SCENARIOS: Scenario[] = [
  // --- Single-column filter-column indexes (the ones the reviewer
  //     flagged as risky to drop) ---
  {
    name: "filter: condition = 'after_renovation'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND condition = 'after_renovation' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: construction = 'brick'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND construction = 'brick' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: ownership = 'cooperative'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND ownership = 'cooperative' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: furnishing = 'furnished'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND furnishing = 'furnished' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: energy_rating = 'A'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND energy_rating = 'A' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: layout = '2+kk'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND layout = '2+kk' ORDER BY listed_at DESC LIMIT 20`,
  },

  // --- Candidates still at zero scans after the UI test ---
  {
    name: "filter: city = 'Praha'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND city = 'Praha' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: city = 'Tábor' (rare)",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND city = 'Tábor' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: district = 'Praha 6'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND district = 'Praha 6' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: region = 'Jihomoravský kraj'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND region = 'Jihomoravský kraj' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: property_type = 'flat'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND property_type = 'flat' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: property_type = 'land' (rare)",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND property_type = 'land' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: transaction_type = 'rent'",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND transaction_type = 'rent' ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: source = 'realingo' (smallest source)",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND source = 'realingo' ORDER BY listed_at DESC LIMIT 20`,
  },

  // --- Price (8 existing scans, marginal) ---
  {
    name: "filter: price between 10M and 15M",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND price BETWEEN 10000000 AND 15000000 ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "filter: price > 15M, no order",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true AND price > 15000000 LIMIT 20`,
  },

  // --- Sanity-check scenarios for the indexes we know are hot ---
  {
    name: "default sort (no filter)",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true ORDER BY listed_at DESC LIMIT 20`,
  },
  {
    name: "price sort (no filter)",
    sql: `SELECT id FROM listings WHERE is_active = true AND is_canonical = true ORDER BY price ASC NULLS LAST LIMIT 20`,
  },
  {
    name: "markers bbox (Praha)",
    sql: `SELECT id, latitude, longitude FROM listings WHERE is_active = true AND latitude BETWEEN 50.0 AND 50.15 AND longitude BETWEEN 14.3 AND 14.6`,
  },
];

/**
 * Extract every index name mentioned in an EXPLAIN text plan.
 * Handles all Postgres plan-node variants that name an index:
 *   "Index Scan using <name>"
 *   "Index Scan Backward using <name>"         (used for ORDER BY DESC)
 *   "Index Only Scan using <name>"
 *   "Index Only Scan Backward using <name>"
 *   "Bitmap Index Scan on <name>"
 */
function extractIndexes(plan: string): string[] {
  const patterns = [
    /Index (?:Only )?Scan (?:Backward )?using (\w+)/g,
    /Bitmap Index Scan on (\w+)/g,
  ];
  const found = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(plan)) !== null) {
      found.add(m[1]);
    }
  }
  return [...found];
}

/** True if the plan includes a Seq Scan — a signal that NO index helped. */
function hasSeqScan(plan: string): boolean {
  return /Seq Scan on listings/i.test(plan);
}

async function main() {
  const sql = connect();
  try {
    const scenarioIndexes = new Map<string, string[]>();
    const indexHits = new Map<string, number>();
    const seqScans: string[] = [];

    console.log("=== EXPLAIN per scenario ===\n");
    for (const s of SCENARIOS) {
      const rows = await sql<Array<{ "QUERY PLAN": string }>>`
        EXPLAIN ${sql.unsafe(s.sql)}
      `;
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      const used = extractIndexes(plan);
      const seq = hasSeqScan(plan);

      scenarioIndexes.set(s.name, used);
      for (const idx of used) {
        indexHits.set(idx, (indexHits.get(idx) ?? 0) + 1);
      }
      if (seq) seqScans.push(s.name);

      console.log(`${s.name}`);
      if (used.length === 0 && seq) {
        console.log("  → Seq Scan (NO index used)");
      } else {
        for (const idx of used) {
          console.log(`  → ${idx}`);
        }
        if (seq) console.log("  (+ Seq Scan fallback present)");
      }
      console.log();
    }

    // Summary
    console.log("=== Indexes chosen across all scenarios ===");
    const sorted = [...indexHits.entries()].sort((a, b) => b[1] - a[1]);
    for (const [idx, hits] of sorted) {
      console.log(`  ${idx.padEnd(35)} ${hits} scenarios`);
    }

    // Which candidate drops from PR #9 are NOT chosen for any tested query?
    const DROP_CANDIDATES = [
      "idx_listings_external_id",
      "idx_listings_city",
      "idx_listings_price",
      "idx_listings_source",
      "idx_listings_property_type",
      "idx_listings_transaction_type",
      "idx_listings_district",
      "idx_listings_region",
      "idx_listings_condition",
      "idx_listings_construction",
      "idx_listings_ownership",
      "idx_listings_furnishing",
      "idx_listings_energy_rating",
    ];

    console.log("\n=== Drop-candidate index status ===");
    for (const cand of DROP_CANDIDATES) {
      const hits = indexHits.get(cand) ?? 0;
      const verdict = hits === 0 ? "SAFE to drop (no EXPLAIN hit)" : `KEEP — chosen by planner in ${hits} scenario(s)`;
      console.log(`  ${cand.padEnd(35)} ${verdict}`);
    }

    if (seqScans.length > 0) {
      console.log("\n=== Seq scans (planner fell back — worth investigating) ===");
      for (const name of seqScans) console.log(`  ${name}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
