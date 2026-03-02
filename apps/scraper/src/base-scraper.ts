import pLimit from "p-limit";
import type { ScraperResult } from "@flat-finder/types";
import { HttpClient } from "./http-client.js";

export interface ScraperOptions {
  rps: number;
  concurrency: number;
  maxRetries: number;
  retryBaseMs: number;
  timeoutMs: number;
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

  constructor(opts: ScraperOptions) {
    this.concurrency = opts.concurrency;
    this._opts = opts;
    this.limiter = pLimit(opts.concurrency);
  }

  /**
   * Initialize the HTTP client. Must be called once the subclass `name`
   * field is available (i.e. after the subclass constructor has run).
   * Scrapers call this lazily on first use via the `log` / `http` getters,
   * or eagerly at the start of fetchListings().
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
    console.log(`[${this.name}]`, msg, ...args);
  }

  /**
   * Fetch all listings from this source.
   * Implementations should return a flat array of ScraperResult objects
   * ready to be upserted.
   */
  abstract fetchListings(): Promise<ScraperResult[]>;
}
