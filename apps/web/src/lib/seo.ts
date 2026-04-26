/**
 * Global SEO kill switch.
 *
 * When `SEO_NOINDEX=true` in the environment, every Next.js metadata path
 * serves `<meta name="robots" content="noindex,nofollow">` and the
 * sitemap link drops out of `/robots.txt`. Crawling itself stays allowed
 * — Googlebot needs to fetch the page to *see* the noindex meta and
 * drop the URL from the index. (`Disallow: /` would have the perverse
 * effect of *preserving* already-indexed URLs because Google would
 * never re-fetch and find the noindex.)
 *
 * Flip on droplet: edit `/root/flat-finder-cz/.env`, add `SEO_NOINDEX=true`,
 * rebuild web (`npm -w apps/web run build`), `pm2 restart web`. Reverse
 * by removing the env line and redeploying.
 *
 * The original allow-all SEO surface (robots.ts allow rules, layout
 * metadata defaults, per-listing index/follow) is preserved — this flag
 * just shadows them when set.
 */
export const SEO_NOINDEX = process.env.SEO_NOINDEX === "true";

/** Reusable Metadata.robots value for "we don't want this indexed". */
export const NOINDEX_ROBOTS = { index: false, follow: false } as const;
