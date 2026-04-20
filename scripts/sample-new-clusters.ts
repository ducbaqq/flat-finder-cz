/**
 * One-shot: samples a few clusters that were most recently updated, showing
 * source+URL for each sibling so you can eyeball whether they're genuine
 * cross-source duplicates. Use after running --apply to verify.
 */
import { createDb } from "@flat-finder/db";
import { sql } from "drizzle-orm";

async function main() {
  const conn = createDb();
  try {
    // Pick 3 distinct recently-updated cluster_ids with 2+ members from
    // 2+ distinct sources — those are the most interesting to eyeball.
    const clusters = (await conn.db.execute<{
      cluster_id: string;
      members: string;
      sources: string;
    }>(sql`
      SELECT
        cluster_id,
        COUNT(*)::text AS members,
        COUNT(DISTINCT source)::text AS sources
      FROM listings
      WHERE cluster_id IS NOT NULL
        AND is_active = true
      GROUP BY cluster_id
      HAVING COUNT(DISTINCT source) >= 2
      ORDER BY MAX(id) DESC
      LIMIT 3
    `)) as Array<{ cluster_id: string; members: string; sources: string }>;

    if (clusters.length === 0) {
      console.log("No clusters with 2+ sources found.");
      return;
    }

    for (const c of clusters) {
      console.log(`\n── cluster ${c.cluster_id} — ${c.members} members, ${c.sources} sources`);

      const rows = (await conn.db.execute<{
        id: number;
        source: string;
        source_url: string | null;
        price: number | null;
        size_m2: number | null;
        layout: string | null;
        transaction_type: string | null;
        latitude: number | null;
        longitude: number | null;
        address: string | null;
        is_canonical: boolean;
      }>(sql`
        SELECT id, source, source_url, price, size_m2, layout,
               transaction_type, latitude, longitude, address, is_canonical
        FROM listings
        WHERE cluster_id = ${c.cluster_id} AND is_active = true
        ORDER BY source, id
      `)) as Array<{
        id: number;
        source: string;
        source_url: string | null;
        price: number | null;
        size_m2: number | null;
        layout: string | null;
        transaction_type: string | null;
        latitude: number | null;
        longitude: number | null;
        address: string | null;
        is_canonical: boolean;
      }>;

      for (const r of rows) {
        const canon = r.is_canonical ? " [CANONICAL]" : "";
        console.log(
          `  #${r.id} ${r.source}${canon}  ${r.transaction_type} ${r.size_m2}m² ${r.layout ?? "—"}  ${r.price ?? "?"} CZK  (${r.latitude?.toFixed(4)}, ${r.longitude?.toFixed(4)})`,
        );
        console.log(`    ${r.address ?? "(no address)"}`);
        console.log(`    ${r.source_url ?? "(no URL)"}`);
      }
    }
  } finally {
    await conn.sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
