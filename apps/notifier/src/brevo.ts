import { getEnv } from "@flat-finder/config";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000] as const;

class BrevoError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "BrevoError";
  }
}

/**
 * Parse a `Retry-After` header. Brevo (and most APIs) emit the
 * delta-seconds form, but the HTTP spec also allows an absolute date.
 * Returns the wait duration in milliseconds, or null if unparseable or
 * absurd (>60s — fall back to our standard backoff).
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Numeric seconds form.
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (seconds > 60) return null;
    return seconds * 1000;
  }

  // HTTP-date form.
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) return null;
  const delta = ts - Date.now();
  if (delta <= 0) return 0;
  if (delta > 60_000) return null;
  return delta;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SendBrevoEmailOptions {
  /**
   * Optional subject override. Brevo accepts this in the JSON body and
   * uses it instead of the template's stored subject — lets the worker
   * pluralize ("1 nová nabídka", "5 nových nabídek") per email.
   */
  subject?: string;
}

/**
 * Send a transactional email via Brevo (Sendinblue) API.
 *
 * Throws `BrevoError` on terminal failure. Retries up to 3 times with
 * 1s/4s/16s backoff for transient failures (5xx, 429, network errors).
 * 401 (auth) and 4xx other than 429 are terminal — retrying won't help.
 *
 * The throw-on-failure shape lets the caller distinguish "send succeeded,
 * commit audit row" from "send failed, leave audit row absent so we
 * naturally retry next cycle".
 */
export async function sendBrevoEmail(
  toEmail: string,
  templateId: number,
  params: Record<string, unknown>,
  options: SendBrevoEmailOptions = {},
): Promise<void> {
  const env = getEnv();

  const payload: Record<string, unknown> = {
    to: [{ email: toEmail }],
    templateId,
    params,
    sender: {
      email: env.BREVO_SENDER_EMAIL,
      name: env.BREVO_SENDER_NAME,
    },
  };
  if (options.subject) {
    payload.subject = options.subject;
  }

  let lastError: BrevoError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // TEMPORARY: dump the outgoing payload so we can compare what
      // succeeds vs what fails when Brevo silently rejects with
      // "template not exists" after a 201 response. Revert after
      // diagnosing.
      console.log(
        `[DEBUG] Brevo payload for ${toEmail}: ${JSON.stringify(payload).slice(0, 4000)}`,
      );
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": env.BREVO_API_KEY,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        // Brevo returns `{messageId: "..."}` on 201. Log it so a failed
        // delivery in their transactional dashboard can be correlated
        // back to a specific notifier cycle.
        const okBody = await response.text().catch(() => "");
        let messageId: string | undefined;
        try {
          messageId = (JSON.parse(okBody) as { messageId?: string }).messageId;
        } catch {
          /* ignore */
        }
        console.log(
          `[INFO] Brevo API responded ${response.status} for ${toEmail}` +
            (messageId ? ` (messageId=${messageId})` : "") +
            (attempt > 0 ? ` (attempt ${attempt + 1})` : ""),
        );
        return;
      }

      const body = await response.text().catch(() => "");
      const truncated = body.slice(0, 500);

      // Auth misconfiguration — retrying just amplifies the noise.
      if (response.status === 401 || response.status === 400) {
        throw new BrevoError(
          `Brevo API HTTP ${response.status} (terminal): ${truncated}`,
          response.status,
          truncated,
        );
      }

      // 429: honor Retry-After if present and reasonable.
      if (response.status === 429) {
        const wait =
          parseRetryAfter(response.headers.get("retry-after")) ??
          BACKOFF_MS[attempt] ??
          BACKOFF_MS[BACKOFF_MS.length - 1];
        lastError = new BrevoError(
          `Brevo API HTTP 429 (rate limited): ${truncated}`,
          429,
          truncated,
        );
        if (attempt < MAX_ATTEMPTS - 1) {
          console.warn(
            `[WARN] Brevo 429 for ${toEmail}, sleeping ${wait}ms before retry ${attempt + 2}/${MAX_ATTEMPTS}`,
          );
          await sleep(wait);
          continue;
        }
        throw lastError;
      }

      // 5xx → retry with standard backoff.
      if (response.status >= 500 && response.status < 600) {
        lastError = new BrevoError(
          `Brevo API HTTP ${response.status}: ${truncated}`,
          response.status,
          truncated,
        );
        if (attempt < MAX_ATTEMPTS - 1) {
          const wait = BACKOFF_MS[attempt];
          console.warn(
            `[WARN] Brevo ${response.status} for ${toEmail}, sleeping ${wait}ms before retry ${attempt + 2}/${MAX_ATTEMPTS}`,
          );
          await sleep(wait);
          continue;
        }
        throw lastError;
      }

      // Other 4xx — terminal.
      throw new BrevoError(
        `Brevo API HTTP ${response.status} (terminal): ${truncated}`,
        response.status,
        truncated,
      );
    } catch (error) {
      // Already a BrevoError → propagate / retry-decision was made above.
      if (error instanceof BrevoError) {
        // Terminal errors (401/400/other-4xx) bubble up immediately.
        if (
          error.status === 401 ||
          error.status === 400 ||
          (error.status != null &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429)
        ) {
          throw error;
        }
        lastError = error;
        // Retry already triggered via continue; if we get here, the loop ended.
        continue;
      }

      // Network / abort / DNS — treat as transient.
      const message = error instanceof Error ? error.message : String(error);
      lastError = new BrevoError(`Brevo API network error: ${message}`);
      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = BACKOFF_MS[attempt];
        console.warn(
          `[WARN] Brevo network error for ${toEmail} (${message}), sleeping ${wait}ms before retry ${attempt + 2}/${MAX_ATTEMPTS}`,
        );
        await sleep(wait);
        continue;
      }
      throw lastError;
    }
  }

  // Unreachable in theory — every path either returns or throws — but
  // leave a safety net so a future refactor doesn't silently swallow.
  throw lastError ?? new BrevoError("Brevo API: exhausted retries");
}

export { BrevoError };
