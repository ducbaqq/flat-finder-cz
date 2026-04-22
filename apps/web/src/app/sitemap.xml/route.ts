import { SITE_URL } from "@/lib/listing-server";

export const runtime = "nodejs";
// Re-generate daily so new static pages show up without a deploy, but the
// index itself is cheap to cache between requests.
export const revalidate = 86_400;

/**
 * Root sitemap index. References:
 *   - /sitemap-pages.xml — a handful of static marketing URLs
 *   - /sitemap-listings.xml — the dynamic, DB-backed listing URLs
 *
 * Crawlers fetch each referenced sitemap independently, so splitting the
 * dynamic listings into their own file means the hot-path generator only
 * runs when Google actually re-fetches it (cached for an hour) — the
 * static pages index can live at a slower revalidate cadence.
 */
export async function GET() {
  const now = new Date().toISOString().slice(0, 10);

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    "  <sitemap>\n" +
    `    <loc>${SITE_URL}/sitemap-pages.xml</loc>\n` +
    `    <lastmod>${now}</lastmod>\n` +
    "  </sitemap>\n" +
    "  <sitemap>\n" +
    `    <loc>${SITE_URL}/sitemap-listings.xml</loc>\n` +
    `    <lastmod>${now}</lastmod>\n` +
    "  </sitemap>\n" +
    "</sitemapindex>\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
