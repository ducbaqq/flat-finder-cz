import { SITE_URL } from "@/lib/listing-server";

export const runtime = "nodejs";
export const revalidate = 86_400;

/**
 * Static-page sitemap. Listings live in /sitemap-listings.xml; this one
 * covers the handful of marketing/search URLs we want indexed.
 */
const PAGES: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/search", priority: "0.9", changefreq: "hourly" },
];

export async function GET() {
  const now = new Date().toISOString().slice(0, 10);

  const entries = PAGES.map(
    (p) =>
      "  <url>\n" +
      `    <loc>${SITE_URL}${p.path}</loc>\n` +
      `    <lastmod>${now}</lastmod>\n` +
      `    <changefreq>${p.changefreq}</changefreq>\n` +
      `    <priority>${p.priority}</priority>\n` +
      "  </url>",
  ).join("\n");

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries +
    "\n</urlset>\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
