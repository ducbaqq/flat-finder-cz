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
 * Run up to `parallelism` async generators concurrently, yielding results
 * from a shared queue as soon as any producer emits. No chunk buffering.
 *
 * Safety: the returned generator only terminates after every producer has
 * finished pushing. If the consumer breaks out early, in-flight producers
 * run to completion harmlessly (no cancellation).
 */
export async function* streamInterleave<T>(
  items: T[],
  parallelism: number,
  fn: (item: T) => AsyncGenerator<PageResult>,
): AsyncGenerator<PageResult> {
  const queue: PageResult[] = [];
  let resolve: (() => void) | null = null;

  const catLimit = pLimit(parallelism);

  const producers = items.map((item) =>
    catLimit(async () => {
      for await (const page of fn(item)) {
        queue.push(page);
        resolve?.();
      }
    }),
  );

  const allDone = Promise.all(producers);
  let finished = false;
  allDone.finally(() => { finished = true; resolve?.(); });

  while (!finished || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
    } else {
      await new Promise<void>((r) => { resolve = r; });
    }
  }
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

  // --------------------------------------------------------------------
  // Liveness classification (freshness sweep)
  // --------------------------------------------------------------------

  /**
   * Default liveness verdict: 404/410 → dead; 2xx → alive; everything
   * else (3xx, 429, 5xx, network error) → unknown. Subclasses override
   * for portals that do soft-404s or 301-to-search on removed listings.
   */
  classifyLiveness(res: LivenessResponse): LivenessVerdict {
    if (res.status === 404 || res.status === 410) return "dead";
    if (res.status >= 200 && res.status < 300) return "alive";
    return "unknown";
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

// ------------------------------------------------------------------------
// Liveness classification types (shared by BaseScraper + refresh engine)
// ------------------------------------------------------------------------

export type LivenessVerdict = "alive" | "dead" | "unknown";

export interface LivenessResponse {
  /** Final response status. `0` when the request errored before a response. */
  status: number;
  /** `Location` header on 3xx; empty on non-redirect. */
  location: string;
  /** URL we actually hit — helpful for classifiers that inspect domain/path. */
  url: string;
  /** First ~1 MB of body text, lower-cased already. Empty on non-text / fetch failures. */
  body: string;
  /** `true` if the fetch threw (DNS, connect timeout, TLS, etc.). */
  networkError: boolean;
}
