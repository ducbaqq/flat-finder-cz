import "server-only";
import { SITE_URL } from "@/lib/listing-server";

// Sitemap protocol hard cap is 50,000 URLs per file. When we cross that
// threshold we'll need to switch to a sitemap-index with paginated
// /sitemap-listings-[n].xml children (1..N). For now we log + truncate
// so the file never violates the spec, and the TODO below calls out
// the split work.
const MAX_URLS_PER_SITEMAP = 50_000;

// Cache for an hour — listings churn but an hourly crawl is plenty
// frequent, and it keeps DB pressure off the shared managed Postgres.
const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dynamic XML sitemap for all active listings. Served at
 * /sitemap-listings.xml and referenced from /sitemap.xml.
 *
 * @flat-finder/db is imported lazily inside the handler so Next's build-
 * time route analyzer doesn't try to resolve the drizzle ESM graph at
 * build time — the `import.meta.dirname`-based CA-cert path resolution
 * in db/client.ts breaks under webpack's compile context. Deferring the
 * import keeps it strictly a runtime dependency.
 */
export async function GET() {
  // Lazy import — see note above.
  const [{ createDb, listings }, { and, eq, isNotNull }] = await Promise.all([
    import("@flat-finder/db"),
    import("drizzle-orm"),
  ]);

  const { db, sql } = createDb();
  try {
    const rows = await db
      .select({
        id: listings.id,
        enriched_at: listings.enriched_at,
        scraped_at: listings.scraped_at,
        created_at: listings.created_at,
      })
      .from(listings)
      .where(and(eq(listings.is_active, true), isNotNull(listings.created_at)))
      .limit(MAX_URLS_PER_SITEMAP);

    // Sitemap XML is line-oriented; we build it via array.join to avoid
    // repeated string concatenation allocations in the hot path.
    const urls = rows.map((row) => {
      // Prefer enriched_at (detail page fetched) > scraped_at (listing
      // present) > created_at (first seen) for lastmod — earlier dates
      // suggest stale content to crawlers.
      const lastmodRaw =
        row.enriched_at ?? row.scraped_at ?? row.created_at ?? null;
      const lastmod = lastmodRaw
        ? toIsoDate(lastmodRaw)
        : toIsoDate(new Date().toISOString());
      return (
        "  <url>\n" +
        `    <loc>${SITE_URL}/listing/${row.id}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        "    <priority>0.6</priority>\n" +
        "  </url>"
      );
    });

    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join("\n") +
      "\n</urlset>\n";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } finally {
    // Always release the connection — dangling connections pile up fast
    // on the managed DB (~25 conn cap).
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

function toIsoDate(value: string): string {
  // Drizzle returns timestamps as "YYYY-MM-DD HH:MM:SS.sss" in string
  // mode. Normalize to ISO 8601 date (YYYY-MM-DD) — sitemap crawlers
  // accept either full ISO or date-only, and date-only is less prone
  // to timezone-misinterpretation complaints in Search Console.
  const first10 = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(first10)) return first10;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}
