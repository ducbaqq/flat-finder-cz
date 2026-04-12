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
    // Protect everything except: /login, /_next, /api, static files
    "/((?!login|_next|api|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
