import { RateLimiter } from "./rate-limiter.js";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export interface HttpClientOptions {
  rps: number;
  maxRetries: number;
  retryBaseMs: number;
  timeoutMs: number;
  name?: string;
}

/**
 * HTTP client with built-in rate limiting and exponential-backoff retry.
 *
 * Uses native `fetch()`.  Retries on HTTP 429, 5xx, and network / timeout
 * errors.  Does NOT retry 4xx (except 429) or JSON parse errors.
 */
export class HttpClient {
  private readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly name: string;

  constructor(opts: HttpClientOptions) {
    this.rateLimiter = new RateLimiter(opts.rps, opts.name);
    this.maxRetries = opts.maxRetries;
    this.retryBaseMs = opts.retryBaseMs;
    this.timeoutMs = opts.timeoutMs;
    this.name = opts.name ?? "";
  }

  /**
   * Perform a GET request and return parsed JSON (or raw text if JSON
   * parsing fails).
   */
  async get<T = unknown>(
    url: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.requestWithRetry("GET", url, undefined, headers);
  }

  /**
   * Perform a POST request with a JSON body and return parsed JSON.
   */
  async post<T = unknown>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.requestWithRetry("POST", url, body, headers);
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private async requestWithRetry<T>(
    method: string,
    url: string,
    body: unknown | undefined,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      await this.rateLimiter.acquire();

      try {
        return await this.doFetch<T>(method, url, body, extraHeaders);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (!this.isRetryable(lastError)) {
          throw lastError;
        }

        const backoff = this.retryBaseMs * 2 ** attempt;
        const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
        console.warn(
          `${t} [${this.name}] Retry ${attempt + 1}/${this.maxRetries} after ${backoff}ms — ${lastError.message}`,
        );
        await sleep(backoff);
      }
    }

    throw lastError!;
  }

  private async doFetch<T>(
    method: string,
    url: string,
    body: unknown | undefined,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/html,*/*",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      ...extraHeaders,
    };

    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        const err = new HttpError(
          `HTTP ${res.status} ${res.statusText}: ${url}`,
          res.status,
          errBody,
        );
        throw err;
      }

      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        // Return raw text if JSON parsing fails (some endpoints return HTML)
        return text as unknown as T;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private isRetryable(err: Error): boolean {
    if (err instanceof HttpError) {
      return err.status === 429 || err.status >= 500;
    }
    // Network / timeout errors are retryable
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return true;
    }
    if (
      err.message.includes("fetch failed") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ENOTFOUND") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("network")
    ) {
      return true;
    }
    return false;
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
