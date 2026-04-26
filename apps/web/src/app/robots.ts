import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/listing-server";
import { SEO_NOINDEX } from "@/lib/seo";

/**
 * Gates crawler access and points them at the sitemap index. We indexed
 * nothing site-wide in the past; now the canonical listing pages and
 * the static search/home pages are fair game, while the app-only
 * login route stays disallowed.
 *
 * When `SEO_NOINDEX` is on, we still allow crawling so Googlebot can
 * fetch each page and see the `noindex` meta — but we drop the sitemap
 * link so we're not actively promoting URLs we want de-indexed.
 */
export default function robots(): MetadataRoute.Robots {
  const base: MetadataRoute.Robots = {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/listing/", "/search"],
        disallow: ["/api/", "/login", "/@modal/"],
      },
    ],
    host: SITE_URL,
  };
  if (SEO_NOINDEX) return base;
  return { ...base, sitemap: `${SITE_URL}/sitemap.xml` };
}
