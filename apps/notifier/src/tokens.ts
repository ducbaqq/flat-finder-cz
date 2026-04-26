import { createHmac } from "node:crypto";
import { getEnv } from "@flat-finder/config";

export type WatchdogTokenAction = "manage" | "pause" | "unsubscribe";

let warnedAboutMissingSecret = false;

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeBuffer(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Build a signed URL pointing at /watchdog/manage with a compact
 * `{payload}.{sig}` token.
 *
 *   payload = base64url( JSON.stringify({ w, a, t }) )
 *   sig     = base64url( HMAC-SHA256(secret, payload) )
 *
 * The shape is JWT-flavored without the JOSE header (the v1 stub
 * landing page doesn't decode anything; full verification arrives
 * with the unsubscribe-page agent).
 *
 * If `WATCHDOG_TOKEN_SECRET` is empty (default in development), we
 * gracefully degrade to a tokenless URL — emails still send, the
 * landing page falls back to generic instructions, and we warn once
 * so it's caught in pre-launch checklist review.
 */
export function signTokenUrl(
  watchdogId: number,
  action: WatchdogTokenAction,
): string {
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/+$/, "");
  const manageBase = `${base}/watchdog/manage`;

  if (!env.WATCHDOG_TOKEN_SECRET) {
    if (!warnedAboutMissingSecret) {
      console.warn(
        "[WARN] WATCHDOG_TOKEN_SECRET not set — emitting unsigned watchdog URLs. Set the secret before public launch.",
      );
      warnedAboutMissingSecret = true;
    }
    return manageBase;
  }

  const payload = base64UrlEncode(
    JSON.stringify({
      w: watchdogId,
      a: action,
      t: Math.floor(Date.now() / 1000),
    }),
  );
  const sig = base64UrlEncodeBuffer(
    createHmac("sha256", env.WATCHDOG_TOKEN_SECRET).update(payload).digest(),
  );
  const token = `${payload}.${sig}`;
  return `${manageBase}?token=${token}`;
}
