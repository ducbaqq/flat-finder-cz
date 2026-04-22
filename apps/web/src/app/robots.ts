import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/listing-server";

/**
 * Gates crawler access and points them at the sitemap index. We indexed
 * nothing site-wide in the past; now the canonical listing pages and
 * the static search/home pages are fair game, while the app-only
 * filter/login routes stay disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/listing/", "/search"],
        disallow: ["/api/", "/filter/", "/login", "/@modal/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
