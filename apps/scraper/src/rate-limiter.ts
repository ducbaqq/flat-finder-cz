/**
 * Token-bucket rate limiter for Node.js async/await.
 *
 * Enforces a maximum requests-per-second (RPS) by tracking the last
 * request timestamp and sleeping the necessary interval before allowing
 * the next call through.
 *
 * Concurrency is handled separately by p-limit; this class only
 * controls the *rate* of acquisition.
 */
export class RateLimiter {
  private readonly interval: number; // ms between requests
  private lastTime = 0; // hrtime ms of last acquisition
  private readonly name: string;

  constructor(rps: number, name = "") {
    this.interval = rps > 0 ? 1000 / rps : 0;
    this.name = name;
  }

  /**
   * Wait until the rate-limit window allows another request.
   * Returns a promise that resolves once the caller may proceed.
   */
  async acquire(): Promise<void> {
    while (true) {
      const now = performance.now();
      const wait = this.lastTime + this.interval - now;
      if (wait <= 0) {
        this.lastTime = now;
        return;
      }
      await sleep(wait);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
