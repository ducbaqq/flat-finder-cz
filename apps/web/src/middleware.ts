import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const auth = request.cookies.get("site_auth")?.value;
  if (auth === "authenticated") return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Protect everything EXCEPT:
    //   /login          — the gate itself
    //   /_next          — Next internals + static chunks
    //   /api            — Hono API (already authenticated or public)
    //   /listing/*      — canonical SEO detail pages (must be crawlable)
    //   favicon / robots / sitemap variants — crawler-facing assets
    //
    // Keep the login gate over /, /search, /filter — the app UI is still
    // preview-mode while scrape data matures. Only the SEO surface
    // (listing detail pages + sitemaps + robots) is publicly crawlable.
    "/((?!login|_next|api|listing|favicon\\.ico|robots\\.txt|sitemap\\.xml|sitemap-listings\\.xml|sitemap-pages\\.xml).*)",
  ],
};
