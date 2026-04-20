"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackPageView } from "@/lib/analytics";

/**
 * Fires a GA4 page_view every time the pathname OR search params change.
 * We disable gtag's built-in auto-pageview via `send_page_view: false` in
 * the layout-level config, so this component is the single source of
 * truth for page_view — including client-side route changes and query-
 * only updates like `?listing=123` (detail modal) or filter tweaks.
 */
export default function AnalyticsListener() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const qs = searchParams?.toString();
    const path = qs ? `${pathname}?${qs}` : pathname;
    trackPageView(path);
  }, [pathname, searchParams]);

  return null;
}
