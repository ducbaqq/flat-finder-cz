import type { ScraperResult, PageResult } from "./types.js";
import { HttpClient, type HttpClientOptions } from "./http-client.js";
import { ScraperDb } from "./db.js";

export interface ScraperOptions extends HttpClientOptions {
  maxPages?: number;
}

export abstract class BaseScraper {
  abstract readonly name: string;
  abstract readonly sourceName: string;
  protected http: HttpClient;
  protected db: ScraperDb | null = null;
  protected readonly maxPages: number;
  protected readonly rps: number;

  /** Override to true in subclasses that implement fetchPages + enrichListings */
  protected readonly hasDetailPhase: boolean = false;

  constructor(opts: ScraperOptions = {}) {
    this.http = new HttpClient(opts);
    this.maxPages = opts.maxPages ?? Infinity;
    this.rps = opts.rps ?? 5;
  }

  protected log(msg: string, ...args: unknown[]): void {
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`${t} [${this.name}]`, msg, ...args);
  }

  /** Legacy single-phase method — override this for simple scrapers */
  async scrape(): Promise<ScraperResult[]> {
    throw new Error("scrape() not implemented — use fetchPages() for two-phase scrapers");
  }

  /** Two-phase: yields pages of basic listing data */
  async *fetchPages(): AsyncGenerator<PageResult> {
    throw new Error("fetchPages() not implemented");
  }

  /** Two-phase: enrich new listings with detail page data */
  async enrichListings(listings: ScraperResult[]): Promise<ScraperResult[]> {
    return listings;
  }

  async run(): Promise<void> {
    this.db = new ScraperDb(this.sourceName);
    this.log(`Starting scrape (rps=${this.rps}), db: ${this.db.dbPath}`);

    try {
      if (this.hasDetailPhase) {
        await this.runTwoPhase();
      } else {
        await this.runSinglePhase();
      }

      const stats = this.db.getStats();
      this.log("=== Database Stats ===");
      this.log(`Total: ${stats.total}`);
      this.log(`By property type: ${JSON.stringify(stats.by_property_type)}`);
      this.log(`By transaction type: ${JSON.stringify(stats.by_transaction_type)}`);
      this.log(`With price: ${stats.with_price}`);
      this.log(`With location: ${stats.with_location}`);
      this.log(`With images: ${stats.with_images}`);
      this.log(`Top cities: ${JSON.stringify(stats.by_city_top10)}`);

      this.verify(stats);
    } finally {
      this.db?.close();
    }
  }

  private async runSinglePhase(): Promise<void> {
    const listings = await this.scrape();
    this.log(`Scraped ${listings.length} listings total`);

    if (listings.length > 0) {
      this.db!.upsertMany(listings);
      this.log(`Upserted ${listings.length} listings into SQLite`);
    }
  }

  private async runTwoPhase(): Promise<void> {
    const seenIds = new Set<string>();
    let totalNew = 0;
    let totalExisting = 0;
    let totalEnriched = 0;

    for await (const page of this.fetchPages()) {
      const pageIds = page.listings.map((l) => l.external_id);
      for (const id of pageIds) seenIds.add(id);

      // Check which ones already exist in DB
      const existingIds = this.db!.findExistingIds(pageIds);
      const newListings = page.listings.filter((l) => !existingIds.has(l.external_id));
      const existingListings = page.listings.filter((l) => existingIds.has(l.external_id));

      totalNew += newListings.length;
      totalExisting += existingListings.length;

      this.log(
        `${page.category} page ${page.page}/${page.totalPages}: ${newListings.length} new, ${existingListings.length} existing`
      );

      // Enrich only new listings with detail page data
      let enrichedListings = newListings;
      if (newListings.length > 0) {
        enrichedListings = await this.enrichListings(newListings);
        totalEnriched += enrichedListings.length;
      }

      // Upsert all: enriched new + existing (refreshes scraped_at, is_active)
      const allListings = [...enrichedListings, ...existingListings];
      if (allListings.length > 0) {
        this.db!.upsertMany(allListings);
      }
    }

    this.log(`=== Two-Phase Summary ===`);
    this.log(`Total seen: ${seenIds.size} (${totalNew} new, ${totalExisting} existing)`);
    this.log(`Enriched: ${totalEnriched} listings with detail data`);

    // Deactivate listings no longer present on the site
    const deactivated = this.db!.deactivateStale(this.sourceName, seenIds);
    if (deactivated > 0) {
      this.log(`Deactivated: ${deactivated} stale listings`);
    }
  }

  protected verify(stats: ReturnType<ScraperDb["getStats"]>): void {
    const issues: string[] = [];

    if (stats.total === 0) {
      issues.push("CRITICAL: No listings scraped at all!");
    }

    const priceRatio = stats.total > 0 ? stats.with_price / stats.total : 0;
    if (priceRatio < 0.3) {
      issues.push(`WARNING: Only ${(priceRatio * 100).toFixed(1)}% of listings have a price`);
    }

    const locationRatio = stats.total > 0 ? stats.with_location / stats.total : 0;
    if (locationRatio < 0.1) {
      issues.push(`INFO: Only ${(locationRatio * 100).toFixed(1)}% of listings have GPS coordinates (some sites don't provide these)`);
    }

    if (Object.keys(stats.by_property_type).length === 0) {
      issues.push("WARNING: No property types found");
    }

    if (Object.keys(stats.by_transaction_type).length === 0) {
      issues.push("WARNING: No transaction types found");
    }

    if (issues.length > 0) {
      this.log("=== Verification Issues ===");
      for (const issue of issues) {
        this.log(issue);
      }
    } else {
      this.log("=== Verification PASSED ===");
    }
  }
}
