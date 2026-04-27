/**
 * Thin wrapper around window.gtag. All calls no-op when GA isn't loaded
 * (e.g. in dev without NEXT_PUBLIC_GA_MEASUREMENT_ID, on SSR, or on the
 * password-gate login page before any gtag script is injected).
 */

type GtagArgs =
  | ["event", string, Record<string, unknown>?]
  | ["config", string, Record<string, unknown>?]
  | ["js", Date];

declare global {
  interface Window {
    gtag?: (...args: GtagArgs[number] extends infer _ ? never : never) => void;
  }
}

function gtag(...args: unknown[]): void {
  if (typeof window === "undefined") return;
  const fn = (window as unknown as { gtag?: (...args: unknown[]) => void })
    .gtag;
  if (typeof fn !== "function") return;
  fn(...args);
}

/**
 * Strip user-identifying tokens from a URL before sending it to GA4.
 * The watchdog email-link landing carries an HMAC token in `?token=...`;
 * if it leaks into `page_location` it ends up indexed in GA reports.
 */
function sanitizeLocation(href: string): string {
  try {
    const url = new URL(href);
    if (url.pathname.startsWith("/watchdog/manage")) {
      url.searchParams.delete("token");
    }
    return url.toString();
  } catch {
    return href;
  }
}

export function trackPageView(path: string, title?: string): void {
  const rawLocation =
    typeof window !== "undefined" ? window.location.href : path;
  gtag("event", "page_view", {
    page_path: path,
    page_location: sanitizeLocation(rawLocation),
    page_title: title ?? (typeof document !== "undefined" ? document.title : ""),
  });
}

export function trackEvent(
  name: string,
  params?: Record<string, unknown>,
): void {
  gtag("event", name, params);
}

/**
 * Sha256 hex digest. Used to produce non-PII join keys for events that
 * touch user-identifying records (e.g. watchdog rows). Returns the input
 * unchanged on platforms without `crypto.subtle` so events still fire —
 * the param just becomes a fallback string the analyst can ignore.
 */
export async function sha256(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return input;
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Maps the current pathname to a coarse "surface" label. Attached to
 * every listing- or watchdog-touching event so we can attribute
 * conversions back to where the user came from. Keep this list small
 * — proliferating values dilutes GA4's exploration UI.
 */
export function getSurface(pathname?: string): string {
  const p = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  if (p === "/" || p === "") return "home";
  if (p.startsWith("/search")) return "search";
  if (p.startsWith("/listing/")) return "modal_listing";
  if (p.startsWith("/watchdog/manage")) return "manage";
  return "other";
}
