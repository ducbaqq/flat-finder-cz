import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-side verifier for the HMAC-signed watchdog tokens emitted by
 * the notifier (see apps/notifier/src/tokens.ts:signTokenUrl). Same
 * algorithm — base64url(JSON({w, a, t})).base64url(HMAC-SHA256). The
 * shared secret comes from the WATCHDOG_TOKEN_SECRET env var on both
 * apps so the signatures verify without cross-package imports.
 */

export type WatchdogTokenAction = "manage" | "pause" | "unsubscribe";

export interface WatchdogTokenPayload {
  watchdogId: number;
  action: WatchdogTokenAction;
  /** Issued-at, unix seconds. */
  issuedAt: number;
}

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "manage",
  "pause",
  "unsubscribe",
]);

function base64UrlDecodeToString(input: string): string | null {
  try {
    const padded =
      input.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (input.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function base64UrlEncodeBuffer(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Verify a `payload.sig` token. Returns the decoded payload on success,
 * `null` on any failure (malformed, bad signature, missing secret, etc).
 *
 * Caller decides what to do with the action — this util is purely
 * cryptographic. Tokens DO NOT expire by design (clicked from emails
 * potentially weeks old); if a freshness window is ever needed, gate
 * on `payload.issuedAt` at the call site.
 */
export function verifyWatchdogToken(
  token: string | undefined,
  secret: string | undefined,
): WatchdogTokenPayload | null {
  if (!token || !secret) return null;

  const dot = token.indexOf(".");
  if (dot < 1 || dot >= token.length - 1) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expectedSig = base64UrlEncodeBuffer(
    createHmac("sha256", secret).update(payloadB64).digest(),
  );

  // timingSafeEqual requires equal-length buffers; reject up front.
  if (expectedSig.length !== sigB64.length) return null;
  const a = Buffer.from(expectedSig, "utf8");
  const b = Buffer.from(sigB64, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const json = base64UrlDecodeToString(payloadB64);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as { w?: unknown; a?: unknown; t?: unknown };
  const watchdogId = typeof obj.w === "number" ? obj.w : Number(obj.w);
  const action = typeof obj.a === "string" ? obj.a : "";
  const issuedAt = typeof obj.t === "number" ? obj.t : Number(obj.t);

  if (
    !Number.isInteger(watchdogId) ||
    watchdogId <= 0 ||
    !VALID_ACTIONS.has(action) ||
    !Number.isFinite(issuedAt)
  ) {
    return null;
  }

  return {
    watchdogId,
    action: action as WatchdogTokenAction,
    issuedAt,
  };
}
