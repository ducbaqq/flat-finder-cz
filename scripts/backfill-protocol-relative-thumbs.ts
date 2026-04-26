/**
 * Backfill protocol-relative thumbnails (`//www.host/path.jpg`) by promoting
 * `image_urls[0]` when it's a valid absolute http(s) URL pointing at the
 * same file. Same pattern as the 2026-04-22 aggregator-thumbnail-rot
 * backfill, but for the `//`-prefix case (eurobydleni og:image was the
 * source — see scraper fix in apps/scraper/src/scrapers/eurobydleni.ts).
 *
 * Strategy:
 *   - Match rows where thumbnail_url starts with `//`.
 *   - Promote image_urls->>0 only when it's an absolute http(s) URL.
 *   - Fallback: if no usable gallery, prepend `https:` to the existing
 *     thumbnail_url (still better than a relative path).
 */
import postgres from "postgres";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const sql = postgres({
  host: process.env.DB_HOST!,
  port: Number(process.env.DB_PORT!),
  user: process.env.DB_USERNAME!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_DATABASE!,
  ssl: { rejectUnauthorized: false },
});

const before = await sql`
  SELECT
    COUNT(*) FILTER (WHERE thumbnail_url LIKE '//%') AS protocol_relative,
    COUNT(*) FILTER (WHERE thumbnail_url LIKE '//%' AND image_urls->>0 LIKE 'http%') AS fixable_via_gallery
  FROM listings
  WHERE is_active = true
`;
console.log("--- before ---");
console.table(before);

const galleryFix = await sql`
  UPDATE listings
  SET thumbnail_url = image_urls->>0
  WHERE is_active = true
    AND thumbnail_url LIKE '//%'
    AND jsonb_array_length(image_urls) > 0
    AND image_urls->>0 LIKE 'http%'
  RETURNING id
`;
console.log(`gallery-promotion fix: ${galleryFix.length} rows`);

const prefixFix = await sql`
  UPDATE listings
  SET thumbnail_url = 'https:' || thumbnail_url
  WHERE is_active = true
    AND thumbnail_url LIKE '//%'
  RETURNING id
`;
console.log(`https-prefix fallback fix: ${prefixFix.length} rows`);

const after = await sql`
  SELECT COUNT(*) FILTER (WHERE thumbnail_url LIKE '//%') AS protocol_relative_remaining
  FROM listings
  WHERE is_active = true
`;
console.log("--- after ---");
console.table(after);

await sql.end();
