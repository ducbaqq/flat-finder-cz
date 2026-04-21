/**
 * Backfill the 747+ idnes flats whose size_m2 was stored as 1000+real
 * due to the parseIdnesTitleDetails regex bug (fixed 2026-04-21).
 *
 * Strategy: re-run the fixed parser against each affected row's title.
 * If the new result differs from the stored size_m2 AND looks sane
 * (within a plausible flat-size range), UPDATE. Default is dry-run
 * (prints the diff); pass --apply to write.
 *
 * NOTE: after this lands, the primary match_hash generated column
 * auto-recomputes for every updated row (geo+size+price+transaction).
 * Rows will move clusters if their corrected size aligns with another
 * cluster's hash — that's expected and desired.
 */
import postgres from "postgres";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseIdnesTitleDetails } from "../apps/scraper/src/scrapers/idnes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const apply = process.argv.includes("--apply");

const sql = postgres({
  host: process.env.DB_HOST!,
  port: Number(process.env.DB_PORT!),
  user: process.env.DB_USERNAME!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_DATABASE!,
  ssl: { rejectUnauthorized: false },
});

// Narrow scope: only rows that MIGHT be affected. We don't touch rows
// whose size wasn't obviously inflated — if a listing genuinely is
// 1000+m² (warehouses, mansions), the title-based reparse must produce
// the same big number for us to be safe.
const rows = await sql<
  Array<{ id: number; title: string; size_m2: number; layout: string | null; property_type: string }>
>`
  SELECT id, title, size_m2, layout, property_type
  FROM listings
  WHERE source = 'idnes'
    AND size_m2 IS NOT NULL
    AND title IS NOT NULL
    AND property_type IN ('flat', 'house')
`;

let wouldUpdate = 0;
let skipped = 0;
const samples: Array<{ id: number; title: string; before: number; after: number }> = [];

for (const row of rows) {
  const { sizeM2: reparsed } = parseIdnesTitleDetails(row.title);
  if (reparsed === null) {
    skipped++;
    continue;
  }
  if (reparsed === row.size_m2) continue;

  // Sanity: only apply if the reparsed value is plausibly a flat size.
  // If reparsed is >3000 we skip — don't trust the parser for weird sizes.
  if (reparsed <= 0 || reparsed > 3000) {
    skipped++;
    continue;
  }

  // Only update rows whose stored value looks like the inflated
  // "layout_digit * 1000 + real_size" pattern. This is a belt-and-suspenders
  // check: if the reparsed value doesn't divide cleanly into the stored
  // value (i.e. stored = N*1000 + reparsed for some digit N 1..9), skip.
  const diff = row.size_m2 - reparsed;
  const isBugPattern = diff >= 1000 && diff <= 9000 && diff % 1000 === 0;
  if (!isBugPattern) {
    skipped++;
    continue;
  }

  wouldUpdate++;
  if (samples.length < 10) {
    samples.push({
      id: row.id,
      title: row.title,
      before: row.size_m2,
      after: reparsed,
    });
  }

  if (apply) {
    await sql`UPDATE listings SET size_m2 = ${reparsed} WHERE id = ${row.id}`;
  }
}

console.log("--- Samples (first 10) ---");
for (const s of samples) {
  console.log(
    `id=${s.id}  ${s.before} → ${s.after}  "${s.title.slice(0, 70)}"`,
  );
}

console.log("\n--- Totals ---");
console.log(`Scanned:       ${rows.length}`);
console.log(`Would update:  ${wouldUpdate}`);
console.log(`Skipped:       ${skipped}`);
console.log(`Mode:          ${apply ? "APPLIED" : "DRY-RUN (pass --apply to write)"}`);

await sql.end();
