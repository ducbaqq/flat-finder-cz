import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import proj4 from "proj4";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";

// Define S-JTSK (EPSG:5514) coordinate system
proj4.defs(
  "EPSG:5514",
  "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs",
);

/**
 * Convert S-JTSK (Krovak, EPSG:5514) coordinates to WGS84 (lat/lng).
 * Input x, y are negative Krovak values (e.g. x=-854459, y=-992348).
 */
function jtskToWgs84(x: number, y: number): { lat: number; lng: number } {
  const [lng, lat] = proj4("EPSG:5514", "EPSG:4326", [x, y]);
  return { lat, lng };
}

/**
 * Cross-source skip — ereality is itself an aggregator, often re-broadcasting
 * listings from portals we already scrape directly. When the detail page's
 * gallery photos point at one of those portals' image hosts, the listing is
 * a pure duplicate (with worse data fidelity than the direct scrape because
 * we only see ereality's HTML, not the original API). Drop those before
 * upsert; the dedicated source scraper already covers them.
 *
 * Mirrors the pattern in `realingo.ts` (see [[realingo-external-host-skip]]
 * in the Obsidian vault).
 */
const EXTERNALLY_COVERED_HOSTS = [
  "sreality.cz", "bezrealitky.cz", "ulovdomov.cz", "bazos.cz",
  "eurobydleni.cz", "ceskereality.cz", "realitymix.cz",
  "realitymix.com", "idnes.cz", "realingo.cz",
  "1gr.cz",        // iDNES Group's image CDN — sta-reality1.1gr.cz, etc.
] as const;

function isExternallyCoveredHost(url: string): boolean {
  let hostname: string;
  try { hostname = new URL(url).hostname.toLowerCase(); }
  catch { return false; }
  return EXTERNALLY_COVERED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

/**
 * Scan an ereality detail page for gallery image URLs that point at one of
 * the portals we scrape directly. Returns the matched hostname, or null.
 *
 * The gallery is loaded via `foto_done(N, 'URL')` JS calls — that's the
 * canonical "this listing's photos" signal. Sidebar widgets and ads use
 * different markup, so this is precise (no false positives from the
 * "podobné nabídky" widget that already burned us once).
 */
function detectExternalSource(html: string): string | null {
  const pattern = /foto_done\s*\(\s*\d+\s*,\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    if (isExternallyCoveredHost(m[1])) {
      try { return new URL(m[1]).hostname; }
      catch { return "unknown"; }
    }
  }
  return null;
}

/**
 * All category paths to scrape: [urlPath, propertyType, transactionType]
 */
const CATEGORIES: [string, PropertyType, TransactionType][] = [
  // Sale
  ["prodej/byty", "flat", "sale"],
  ["prodej/domy", "house", "sale"],
  ["prodej/pozemky", "land", "sale"],
  ["prodej/komercni-objekty", "commercial", "sale"],
  ["prodej/ostatni", "other", "sale"],
  // Rent
  ["pronajem/byty", "flat", "rent"],
  ["pronajem/domy", "house", "rent"],
  ["pronajem/pozemky", "land", "rent"],
  ["pronajem/komercni-objekty", "commercial", "rent"],
  ["pronajem/ostatni", "other", "rent"],
];

export class ERealityScraper extends BaseScraper {
  readonly name = "ereality";
  readonly baseUrl = "https://www.ereality.cz";

  override get hasDetailPhase() {
    return true;
  }

  constructor(opts: ScraperOptions) {
    super(opts);
  }

  // ─── Phase 1: List Scan ───────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();
    for (const [urlPath, propertyType, transactionType] of CATEGORIES) {
      try {
        yield* this.fetchCategoryPages(urlPath, propertyType, transactionType);
      } catch (err) {
        this.log(`Error scraping category ${urlPath}: ${err}`);
      }
    }
  }

  private async *fetchCategoryPages(
    urlPath: string,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): AsyncGenerator<PageResult> {
    // Fetch the first full page to extract total count
    const firstPageUrl = `${this.baseUrl}/${urlPath}`;
    let firstPageHtml: string;
    try {
      firstPageHtml = await this.http.getHtml(firstPageUrl);
    } catch (err) {
      this.log(`Error fetching first page of ${urlPath}: ${err}`);
      return;
    }

    const totalCount = this.extractTotalCount(firstPageHtml);
    const pgMax = this.extractPgMax(firstPageHtml);
    const totalPages = pgMax + 1; // +1 because pg_max is 0-indexed

    this.log(`Category ${urlPath}: ${totalCount} total listings, pg_max=${pgMax}, ${totalPages} pages`);

    // Parse tiles from first page
    const firstRoot = parseHtml(firstPageHtml);
    const firstTiles = firstRoot.querySelectorAll("li.ereality-property-tile");
    const firstListings = this.parseTiles(firstTiles, propertyType, transactionType);

    if (firstListings.length > 0) {
      yield { category: urlPath, page: 1, totalPages, listings: firstListings };
    }

    if (totalPages <= 1) return;

    // Batch-concurrent fetching of subsequent pages via AJAX
    const batchSize = this.concurrency * 2;
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

    for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
      if (this.isCategorySkipped(urlPath)) return;
      const batchPages = remaining.slice(bStart, bStart + batchSize);

      const pagePromises = batchPages.map((page) =>
        this.limiter(async () => {
          const ajaxUrl = `${this.baseUrl}/ajaxlist/${urlPath}?pg=${page - 1}`;
          try {
            return { page, html: await this.http.getHtml(ajaxUrl) };
          } catch (err) {
            this.log(`Error fetching page ${page} of ${urlPath}: ${err}`);
            return { page, html: null };
          }
        }),
      );

      const pageResults = await Promise.all(pagePromises);

      for (const { page, html } of pageResults) {
        if (this.isCategorySkipped(urlPath)) return;
        if (!html || html.trim().length === 0) continue;

        const root = parseHtml(`<ul>${html}</ul>`);
        const tiles = root.querySelectorAll("li.ereality-property-tile");
        if (tiles.length === 0) continue;

        const listings = this.parseTiles(tiles, propertyType, transactionType);
        if (listings.length > 0) {
          yield { category: urlPath, page, totalPages, listings };
        }
      }
    }
  }

  private extractTotalCount(html: string): number {
    // Look for "celkem 24255" or similar text
    const match = html.match(/celkem\s+([\d\s]+)/i);
    if (!match) return 0;
    return parseInt(match[1].replace(/\s/g, ""), 10) || 0;
  }

  private extractPgMax(html: string): number {
    // Extract pg_max JavaScript variable: var pg_max = 1102;
    const match = html.match(/pg_max\s*=\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
    // Fallback: compute from total count (rough estimate, ~22 per page)
    const totalCount = this.extractTotalCount(html);
    return totalCount > 0 ? Math.ceil(totalCount / 22) : 0;
  }

  private parseTiles(
    tiles: HTMLElement[],
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult[] {
    const listings: ScraperResult[] = [];
    for (const tile of tiles) {
      try {
        const listing = this.parseTile(tile, propertyType, transactionType);
        if (listing) listings.push(listing);
      } catch (err) {
        this.log(`Error parsing tile: ${err}`);
      }
    }
    return listings;
  }

  // ─── Phase 2: Detail Enrichment ───────────────────────────────────

  override async enrichListings(
    listings: ScraperResult[],
    opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    if (listings.length === 0) return;
    this.init();

    this.log(`Enriching ${listings.length} new listings...`);
    const limit = opts?.concurrency ? pLimit(opts.concurrency) : this.limiter;

    const skipIds = new Set<string>();
    const skipHosts: Record<string, number> = {};
    await Promise.all(
      listings.map((listing) =>
        limit(async () => {
          try {
            const skipHost = await this.enrichOne(listing);
            if (skipHost) {
              skipIds.add(listing.external_id);
              skipHosts[skipHost] = (skipHosts[skipHost] ?? 0) + 1;
            }
          } catch (err) {
            this.log(`Failed to enrich ${listing.external_id}: ${err}`);
          }
        }),
      ),
    );

    if (skipIds.size > 0) {
      const breakdown = Object.entries(skipHosts)
        .sort(([, a], [, b]) => b - a)
        .map(([h, n]) => `${h}=${n}`)
        .join(" ");
      this.log(
        `Dropping ${skipIds.size}/${listings.length} cross-listings from sources we scrape directly (${breakdown})`,
      );
      const kept = listings.filter((l) => !skipIds.has(l.external_id));
      listings.length = 0;
      listings.push(...kept);
    }

    // Stats — over the post-filter list, since the dropped rows aren't ours
    const withGps = listings.filter((l) => l.latitude !== null).length;
    const withDesc = listings.filter((l) => l.description !== null).length;
    const withGallery = listings.filter((l) => {
      try { return JSON.parse(l.image_urls).length > 1; } catch { return false; }
    }).length;
    this.log(
      `Enrichment: ${withGps}/${listings.length} GPS, ${withDesc}/${listings.length} description, ${withGallery}/${listings.length} gallery`,
    );
  }

  /**
   * Enrich a single listing. Returns `null` if kept, or a hostname string
   * (e.g. `"www.bezrealitky.cz"`) if the listing is a cross-listing from a
   * portal we scrape directly and should be dropped before upsert.
   */
  private async enrichOne(listing: ScraperResult): Promise<string | null> {
    if (!listing.source_url) return null;

    const url = listing.source_url.startsWith("http")
      ? listing.source_url
      : `${this.baseUrl}${listing.source_url}`;

    const html = await this.http.getHtml(url);

    // Cross-source check: if the gallery photos point at a portal we
    // already scrape, skip — the dedicated scraper covers it with full
    // fidelity. Done BEFORE any other parsing so we don't waste cycles
    // populating fields on a row we're going to drop.
    const externalHost = detectExternalSource(html);
    if (externalHost) return externalHost;

    const root = parseHtml(html);

    // GPS from OpenStreetMap iframe
    const { latitude, longitude } = this.extractGps(html);
    if (latitude !== null && longitude !== null) {
      listing.latitude = latitude;
      listing.longitude = longitude;
    }

    // Full description
    const descEl = root.querySelector("p.ereality-property-description-text");
    if (descEl) {
      listing.description = descEl.text.trim() || listing.description;
    }

    // Full image gallery — on ereality, the detail-page gallery is sourced
    // from the real underlying portal (idnes, sreality, etc.) via the
    // aggregator bounce. Those URLs are more reliable than the list-tile
    // thumbnail, which can be a placeholder or a foreign-host URL that
    // rotates fast. Unconditionally prefer gallery[0] when we have one.
    const images = this.extractImages(html);
    if (images.length > 0) {
      listing.image_urls = JSON.stringify(images);
      listing.thumbnail_url = images[0];
    }

    // Verify/update price from detail page
    const priceEl = root.querySelector("div.ereality-property-price");
    if (priceEl) {
      const { price, currency, priceNote } = this.parsePrice(priceEl.text.trim());
      if (price !== null) {
        listing.price = price;
        listing.currency = currency;
        if (priceNote) listing.price_note = priceNote;
      }
    }

    // Breadcrumb parsing for district/city refinement
    // e.g. "Praha > Praha 3 > Poděbrady > pronájem > byty > 3+kk"
    const breadcrumbLinks = root.querySelectorAll(
      "ul.ereality-breadcrumb li a, nav.breadcrumb a, .breadcrumb a",
    );
    if (breadcrumbLinks.length > 0) {
      const crumbs = breadcrumbLinks.map((a) => a.text.trim()).filter(Boolean);
      for (const crumb of crumbs) {
        // District pattern: contains a digit (Praha 3, Brno 2) or directional suffix
        if (/\d/.test(crumb) || /\b(sever|jih|západ|východ|střed)\b/i.test(crumb)) {
          if (!listing.district) listing.district = crumb;
        }
      }
      // First crumb is often the top-level city
      if (crumbs.length > 0 && !listing.city) {
        listing.city = crumbs[0];
      }
    }

    // SCR-05: Extract property parameters from description text.
    // eReality is an aggregator — detail pages have NO structured parameter
    // tables, dt/dd lists, or labelled sections.  The only source for
    // condition, construction, ownership, energy, furnishing and floor is
    // the free-text description shown under "Popis nemovitosti".
    this.extractPropertyParamsFromDescription(listing);

    // Source attribution from redirect links
    // e.g. /presmeruj/idnes-reality/{hash} → "idnes reality"
    const redirectLinks = root.querySelectorAll("a[href*='/presmeruj/']");
    for (const link of redirectLinks) {
      const href = link.getAttribute("href") ?? "";
      const sourceMatch = href.match(/\/presmeruj\/([^/]+)\//);
      if (sourceMatch) {
        const originalSource = sourceMatch[1].replace(/-/g, " ");
        const existing = listing.additional_params
          ? JSON.parse(listing.additional_params)
          : {};
        existing.original_source = originalSource;
        listing.additional_params = JSON.stringify(existing);
        break;
      }
    }

    return null;
  }

  /**
   * SCR-05: Extract condition, construction, ownership, energy_rating,
   * furnishing, and floor from the listing description text.
   *
   * eReality is an aggregator that shows preview pages from other servers
   * (iDnes reality, sReality, etc.).  Detail pages contain NO structured
   * parameter tables, dt/dd lists, or labelled sections — only a
   * free-text description.  We therefore use regex patterns against Czech
   * natural language in the description to recover what we can.
   *
   * Some descriptions also append semi-structured lines like:
   *   "užitná plocha: 64 m2"
   *   "energetická třída: Třída C"
   */
  private extractPropertyParamsFromDescription(listing: ScraperResult): void {
    const desc = listing.description;
    if (!desc) return;

    // ── Energy rating ────────────────────────────────────────────────
    if (!listing.energy_rating) {
      // Match "energetická třída: Třída C", "PENB: B", "energetická náročnost ... štítkem C"
      const energyMatch =
        desc.match(/energetick[áý]\s+(?:třída|nároč)[^:]*?:\s*(?:Třída\s+)?([A-Ga-g])\b/i) ??
        desc.match(/(?:štítkem|třída|třídou|PENB)\s+([A-Ga-g])\b/i) ??
        desc.match(/\bPENB\s*[:\-–]\s*([A-Ga-g])\b/i);
      if (energyMatch) {
        listing.energy_rating = energyMatch[1].toUpperCase();
      }
    }

    // ── Ownership ────────────────────────────────────────────────────
    if (!listing.ownership) {
      // "osobní vlastnictví", "v osobním vlastnictví", "OV"
      // Also: "osobní 2+1 byt" (common shorthand in Czech real estate listings)
      if (/\bosobní(?:m|ho)?\s+vlastnictví\b/i.test(desc) ||
          /\bOV\b/.test(desc) ||
          /\bosobní\s+\d\+/i.test(desc)) {
        listing.ownership = "osobní";
      } else if (/\bdružstevní(?:m|ho)?\s+(?:vlastnictví\b|byt)/i.test(desc) ||
                 /\bdružstevní\s+\d\+/i.test(desc)) {
        listing.ownership = "družstevní";
      } else if (/\bstátní(?:m|ho)?\s+vlastnictví\b/i.test(desc)) {
        listing.ownership = "státní";
      }
    }

    // ── Construction ─────────────────────────────────────────────────
    if (!listing.construction) {
      if (/\bpanel(?:ový|ové|ová|ového|ovém)?\s+(?:budov|dom|dům|byt)/i.test(desc) ||
          /\bv\s+panel(?:ový|ové|ová|ovém|ového)?\b/i.test(desc)) {
        listing.construction = "panel";
      } else if (/\bcihlov(?:ý|é|á|ém|ého)?\s+(?:budov|dom|dům|byt)/i.test(desc) ||
                 /\bv\s+cihlov(?:ý|é|á|ém|ého)?\b/i.test(desc)) {
        listing.construction = "cihla";
      } else if (/\bdřevostavb/i.test(desc)) {
        listing.construction = "dřevostavba";
      }
    }

    // ── Condition ────────────────────────────────────────────────────
    if (!listing.condition) {
      if (/\bnovostavb/i.test(desc)) {
        listing.condition = "novostavba";
      } else if (/\bpo\s+(?:kompletní\s+)?rekonstrukci\b/i.test(desc)) {
        listing.condition = "po rekonstrukci";
      } else if (/\bpřed\s+rekonstrukcí\b/i.test(desc)) {
        listing.condition = "před rekonstrukcí";
      } else if (/\bvelmi\s+dobr(?:ý|ém)\s+stavu?\b/i.test(desc)) {
        listing.condition = "velmi dobrý";
      } else if (/\bdobr(?:ý|ém)\s+stavu?\b/i.test(desc)) {
        listing.condition = "dobrý";
      }
    }

    // ── Floor ────────────────────────────────────────────────────────
    if (listing.floor === null) {
      // "v 3. patře", "ve 2. NP", "nachází v 1. podlaží"
      const floorMatch =
        desc.match(/v[e]?\s+(\d+)\.\s*(?:patře|NP|nadzemním|podlaží)/i) ??
        desc.match(/(\d+)\.\s*(?:patro|NP|nadzemní\s+podlaží)/i);
      if (floorMatch) {
        listing.floor = parseInt(floorMatch[1], 10);
      }
    }

    // ── Total floors ─────────────────────────────────────────────────
    if (listing.total_floors === null) {
      // "domě se 12 podlažími", "dům má 8 podlaží", "12podlažní", "bytový dům 4 podlaží"
      const totalMatch =
        desc.match(/(?:se|má|o)\s+(\d+)\s+podlaží/i) ??
        desc.match(/(\d+)\s*podlažní/i);
      if (totalMatch) {
        listing.total_floors = parseInt(totalMatch[1], 10);
      }
    }

    // ── Furnishing ───────────────────────────────────────────────────
    if (!listing.furnishing) {
      if (/\bplně\s+(?:za|vy)baven/i.test(desc) || /\bkompletně\s+(?:za|vy)baven/i.test(desc)) {
        listing.furnishing = "vybavený";
      } else if (/\bčástečně\s+(?:za|vy)baven/i.test(desc)) {
        listing.furnishing = "částečně";
      } else if (/\bnev(?:y)?baven/i.test(desc)) {
        listing.furnishing = "nevybavený";
      }
    }
  }

  private extractGps(html: string): { latitude: number | null; longitude: number | null } {
    // Method 1: OpenStreetMap iframe — marker=50.390200%2C12.768500
    const osmMatch = html.match(/marker=([\d.]+)%2C([\d.]+)/);
    if (osmMatch) {
      const lat = parseFloat(osmMatch[1]);
      const lng = parseFloat(osmMatch[2]);
      if (this.isValidCzechCoords(lat, lng)) {
        return { latitude: lat, longitude: lng };
      }
    }

    // Method 2: JTSK (Krovak) coordinates from cadastre link — x=-854459&y=-992348
    const jtskMatch = html.match(/[?&]x=(-?\d+)[^&]*&y=(-?\d+)/);
    if (jtskMatch) {
      const x = parseInt(jtskMatch[1], 10);
      const y = parseInt(jtskMatch[2], 10);
      if (x !== 0 && y !== 0) {
        const { lat, lng } = jtskToWgs84(x, y);
        if (this.isValidCzechCoords(lat, lng)) {
          return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 };
        }
      }
    }

    return { latitude: null, longitude: null };
  }

  private isValidCzechCoords(lat: number, lng: number): boolean {
    return !isNaN(lat) && !isNaN(lng) && lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19;
  }

  private extractImages(html: string): string[] {
    // ereality is an aggregator — listings we keep (after the cross-source
    // skip filter) have galleries hosted on whatever portal originally
    // posted the listing: faraon.cz, remax.cz, agency CDNs, ereality's
    // own static, etc. Don't anchor on any specific host. The canonical
    // "this listing's photos" signal is the `foto_done(N, 'URL')` JS
    // gallery loader that ereality calls per image — the same anchor
    // `detectExternalSource` uses, just collecting URLs instead of
    // matching them against the skip list.
    //
    // Why not scan all <img>/<a> in the page: the sidebar widget
    // ("podobné nabídky") shows iDNES thumbnails of unrelated listings.
    // Matching every image would mix those into the gallery (and that's
    // exactly the bug that put a wrong thumbnail on listing 15394).
    const pattern = /foto_done\s*\(\s*\d+\s*,\s*['"]([^'"]+)['"]/g;
    const urls: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null) {
      urls.push(m[1]);
    }
    // Preserve gallery order; just dedupe in case a listing repeats a URL.
    return [...new Set(urls)];
  }

  // ─── Tile Parsing (shared) ────────────────────────────────────────

  private parseTile(
    tile: HTMLElement,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult | null {
    const linkEl = tile.querySelector("a.ereality-property-image");
    if (!linkEl) return null;

    const href = linkEl.getAttribute("href") ?? "";

    // Ereality decorates list pages with "similar offers" widget tiles that
    // reuse the property-tile class but link to /detail/podobne-nabidky/<hash>
    // aggregator pages rather than real listings. Skip them — treating those
    // pages as detail pages pollutes the DB with title="Podobné nabídky"
    // rows that have no description, price, geo, etc.
    if (href.includes("/podobne-nabidky/")) return null;

    // Ereality is partly an aggregator: many list-page tiles link to
    // /presmeruj/<source>/<hash> redirector URLs that bounce to the
    // canonical listing on sreality / ulovdomov / etc. — sources we
    // already scrape directly. The redirector has no GPS, no specs,
    // and our other scrapers cover the same listing with full data.
    // Skip to avoid 38% duplicate-pollution observed in 2026-04-21
    // audit (168 redirects to sreality, 115 to ulovdomov-cz-s-r-o-).
    if (href.includes("/presmeruj/")) return null;

    // Extract the ID from the onclick handler: kliknuto('ID', 1)
    const onclickAttr = linkEl.getAttribute("onclick") ?? "";
    const idMatch = onclickAttr.match(/kliknuto\('([a-f0-9]+)'/);
    const externalId = idMatch ? idMatch[1] : this.extractIdFromHref(href);
    if (!externalId) return null;

    // Build source URL
    let sourceUrl: string;
    if (href.startsWith("/detail/") || href.startsWith("/presmeruj/")) {
      sourceUrl = `${this.baseUrl}${href}`;
    } else {
      sourceUrl = href;
    }

    // Title
    const headingEl = tile.querySelector("strong.ereality-property-heading");
    const title = headingEl?.text?.trim() ?? null;

    // Locality (city, district)
    const localityEl = tile.querySelector("p.ereality-property-locality");
    const localityText = localityEl?.text?.trim() ?? "";
    const { city, district } = this.parseLocality(localityText);

    // Description snippet
    const descEl = tile.querySelector("p.ereality-property-text");
    const description = descEl?.text?.trim() ?? null;

    // Agency / source
    const agencyEl = tile.querySelector("p.ereality-property-agency");
    const agencyText = agencyEl?.text?.trim() ?? "";
    const sellerCompany = agencyText.replace(/^zdroj:\s*/i, "").trim() || null;

    // Price
    const priceEl = tile.querySelector("div.ereality-property-price");
    const priceText = priceEl?.text?.trim() ?? "";
    const { price, currency, priceNote } = this.parsePrice(priceText);

    // Image — reject placeholders and relative/non-http URLs.
    //
    // Ereality is partly an aggregator and its list-tile <img src> is
    // unreliable: sometimes it's a local placeholder ("/images/empty_byt_3.jpg"),
    // sometimes a relative foto_nem URL, sometimes an absolute URL at a foreign
    // CDN (eurobydleni) that rotates to 404 within hours. We keep only genuine
    // absolute http URLs here; `enrichOne` unconditionally overwrites this
    // with the first image from the real detail-page gallery anyway, so
    // anything we trap here is additional safety for the short window before
    // enrichment completes.
    const imgEl = tile.querySelector("img.ereality-property-photo");
    const rawSrc = imgEl?.getAttribute("src") ?? null;
    const thumbnailUrl =
      rawSrc && /^https?:\/\//i.test(rawSrc) ? rawSrc : null;
    const imageUrls = thumbnailUrl ? JSON.stringify([thumbnailUrl]) : "[]";

    // Try to extract size and layout from title
    const sizeM2 = this.extractSize(title ?? "");
    const layout = this.extractLayout(title ?? "");

    // View count
    const viewSpan = tile.querySelector("span[data-content]");
    const viewContent = viewSpan?.getAttribute("data-content") ?? "";
    const viewMatch = viewContent.match(/(\d+)\s+shlédn/);
    const viewCount = viewMatch ? parseInt(viewMatch[1], 10) : null;

    const now = new Date().toISOString();

    return {
      external_id: `ereality_${externalId}`,
      source: "ereality",
      property_type: propertyType,
      transaction_type: transactionType,
      title,
      description,
      price,
      currency,
      price_note: priceNote,
      address: localityText || null,
      city,
      district,
      region: null,
      latitude: null,
      longitude: null,
      size_m2: sizeM2,
      layout,
      floor: null,
      total_floors: null,
      condition: null,
      construction: null,
      ownership: null,
      furnishing: null,
      energy_rating: null,
      amenities: null,
      image_urls: imageUrls,
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at: null,
      scraped_at: now,
      is_active: true,
      deactivated_at: null,
      seller_name: null,
      seller_phone: null,
      seller_email: null,
      seller_company: sellerCompany,
      additional_params: viewCount ? JSON.stringify({ view_count: viewCount }) : null,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private extractIdFromHref(href: string): string | null {
    const match = href.match(/\/([a-f0-9]{16})$/);
    return match ? match[1] : null;
  }

  private parseLocality(text: string): { city: string | null; district: string | null } {
    if (!text) return { city: null, district: null };

    const parts = text.split(",").map((p) => p.trim());

    let city: string | null = null;
    let district: string | null = null;

    if (parts.length >= 2) {
      city = parts[0].replace(/\s*\(.*?\)\s*/, " ").trim() || null;
      const districtPart = parts[1].trim();
      district = districtPart.replace(/^okres\s+/i, "").trim() || null;
    } else if (parts.length === 1) {
      city = parts[0].trim() || null;
    }

    return { city, district };
  }

  private parsePrice(text: string): {
    price: number | null;
    currency: string;
    priceNote: string | null;
  } {
    if (!text || text.toLowerCase().includes("neuvedena")) {
      return { price: null, currency: "CZK", priceNote: "neuvedena" };
    }

    let currency = "CZK";
    if (text.includes("€") || text.toLowerCase().includes("eur")) {
      currency = "EUR";
    }

    const cleanedText = text.replace(/[^\d]/g, "");
    const price = cleanedText ? parseInt(cleanedText, 10) : null;

    let priceNote: string | null = null;
    if (text.includes("/měsíc")) {
      priceNote = "za měsíc";
    } else if (text.toLowerCase().includes("info v rk") || text.toLowerCase().includes("info v kanceláři")) {
      priceNote = text.trim();
      return { price: null, currency, priceNote };
    }

    return { price: price && price > 0 ? price : null, currency, priceNote };
  }

  private extractSize(title: string): number | null {
    // Allow decimal separator (Czech uses comma, e.g. "84,7 m2"; English
    // titles may use a period). The previous integer-only regex captured
    // just the digits after the comma — "84,7 m2" → 7.
    const match = title.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
    if (!match) return null;
    const val = parseFloat(match[1].replace(",", "."));
    return isNaN(val) ? null : val;
  }

  private extractLayout(title: string): string | null {
    const match = title.match(/(\d\+(?:kk|1|\d))/i);
    if (match) return match[1];

    if (title.toLowerCase().includes("atypick")) return "atypicky";
    if (title.toLowerCase().includes("garsoniér") || title.toLowerCase().includes("garsonka")) return "1+kk";

    return null;
  }
}
