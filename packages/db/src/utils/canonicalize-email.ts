/**
 * Normalize an email address to its uniqueness key.
 *
 * Goal: prevent a single human from creating multiple "active watchdogs"
 * by exploiting the various aliases Gmail and other providers honor.
 *
 * Rules (mirror the SQL backfill in 0007_add_watchdog_notifications.sql
 * for ASCII inputs):
 *   1. trim + lowercase the whole string.
 *   2. Reject if no '@', more than one '@', empty local, or empty domain.
 *   3. Strip everything after the first '+' in the local part
 *      (`email+work@gmail.com` → `email@gmail.com`).
 *   4. If domain is `googlemail.com`, rewrite it to `gmail.com`.
 *   5. If the (post-rewrite) domain is `gmail.com`, strip every '.' from
 *      the local part (`e.m.a.i.l@gmail.com` → `email@gmail.com`).
 *   6. Reassemble `local + "@" + domain`.
 *   7. Re-check that local is non-empty after the +/dot strip
 *      (defensive: `+only@gmail.com` → empty local → throw).
 *
 * Throws `Error("invalid email")` on malformed input. The API layer
 * catches this and returns 400 with a friendly Czech message.
 */
export function canonicalizeEmail(email: string): string {
  if (typeof email !== "string") {
    throw new Error("invalid email");
  }

  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("invalid email");
  }

  // Exactly one '@'.
  const atIndex = trimmed.indexOf("@");
  if (atIndex < 0 || atIndex !== trimmed.lastIndexOf("@")) {
    throw new Error("invalid email");
  }

  let local = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  if (!local || !domain) {
    throw new Error("invalid email");
  }

  // Rule 3: drop +alias suffix.
  const plusIndex = local.indexOf("+");
  if (plusIndex >= 0) {
    local = local.slice(0, plusIndex);
  }

  // Rule 4: googlemail.com → gmail.com.
  if (domain === "googlemail.com") {
    domain = "gmail.com";
  }

  // Rule 5: dots are insignificant for gmail.com local parts.
  if (domain === "gmail.com") {
    local = local.replace(/\./g, "");
  }

  // Rule 7: post-strip non-empty.
  if (!local) {
    throw new Error("invalid email");
  }

  return `${local}@${domain}`;
}
