import pLimit from "p-limit";
import type { ScraperResult } from "@flat-finder/types";
import { HttpClient } from "./http-client.js";

export interface ScraperOptions {
  rps: number;
  concurrency: number;
  maxRetries: number;
  retryBaseMs: number;
  timeoutMs: number;
  watchMode?: boolean;
}

export interface PageResult {
  category: string;
  page: number;
  totalPages: number;
  listings: ScraperResult[];
}

/**
 * Abstract base class for all scrapers.
 *
 * Provides:
 *  - An HttpClient with built-in rate-limiting and retry
 *  - A p-limit concurrency limiter for parallel page / detail fetches
 *  - A prefixed logging helper
 */
export abstract class BaseScraper {
  abstract readonly name: string;
  abstract readonly baseUrl: string;

  protected http!: HttpClient;
  protected readonly limiter: ReturnType<typeof pLimit>;
  protected readonly concurrency: number;

  private readonly _opts: ScraperOptions;
  private _skippedCategories = new Set<string>();

  constructor(opts: ScraperOptions) {
    this.concurrency = opts.concurrency;
    this._opts = opts;
    this.limiter = pLimit(opts.concurrency);
  }

  skipCategory(category: string): void {
    this._skippedCategories.add(category);
  }

  protected isCategorySkipped(category: string): boolean {
    return this._skippedCategories.has(category);
  }

  resetSkippedCategories(): void {
    this._skippedCategories.clear();
  }

  /**
   * Initialize the HTTP client. Must be called once the subclass `name`
   * field is available (i.e. after the subclass constructor has run).
   * Scrapers call this lazily on first use via the `log` / `http` getters,
   * or eagerly at the start of fetchPages().
   */
  protected init(): void {
    if (!this.http) {
      this.http = new HttpClient({
        rps: this._opts.rps,
        maxRetries: this._opts.maxRetries,
        retryBaseMs: this._opts.retryBaseMs,
        timeoutMs: this._opts.timeoutMs,
        name: this.name,
      });
    }
  }

  protected log(msg: string, ...args: unknown[]): void {
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`${t} [${this.name}]`, msg, ...args);
  }

  /**
   * Yield pages one at a time. The runner decides when to stop
   * (incremental early-stop) and when to enrich.
   */
  abstract fetchPages(): AsyncGenerator<PageResult>;

  /** Override in scrapers with a detail phase (Sreality, UlovDomov). */
  async enrichListings(
    _listings: ScraperResult[],
    _opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    // default: no-op (Bezrealitky has no detail phase)
  }

  get hasDetailPhase(): boolean {
    return false;
  }

  /** Convenience: consume generator + enrich. Backwards compat. */
  async fetchListings(): Promise<ScraperResult[]> {
    this.init();
    const all: ScraperResult[] = [];
    for await (const page of this.fetchPages()) {
      all.push(...page.listings);
    }
    await this.enrichListings(all);
    return all;
  }
}
