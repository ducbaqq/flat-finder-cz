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

export function trackPageView(path: string, title?: string): void {
  gtag("event", "page_view", {
    page_path: path,
    page_location: typeof window !== "undefined" ? window.location.href : path,
    page_title: title ?? (typeof document !== "undefined" ? document.title : ""),
  });
}

export function trackEvent(
  name: string,
  params?: Record<string, unknown>,
): void {
  gtag("event", name, params);
}
