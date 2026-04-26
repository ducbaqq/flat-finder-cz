import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import AnalyticsListener from "@/components/analytics/AnalyticsListener";
import WatchdogModal from "@/components/watchdog/WatchdogModal";
import ReportProblemModal from "@/components/report-problem/ReportProblemModal";
import { SEO_NOINDEX, NOINDEX_ROBOTS } from "@/lib/seo";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
  variable: "--font-figtree",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-bricolage",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Bytomat.cz — Najděte svůj nový domov",
    template: "%s | Bytomat.cz",
  },
  metadataBase: new URL("https://bytomat.com"),
  // robots defaults are normally driven per-route. Listing detail pages
  // override via generateMetadata({robots}); pages that should stay out
  // of the index (e.g. /login) set it locally too. The SEO_NOINDEX
  // kill-switch (apps/web/src/lib/seo.ts) shadows everything when on,
  // forcing site-wide noindex for the "live but not yet ready for
  // Google" window. Toggle by setting `SEO_NOINDEX=true` in .env on
  // the droplet, then rebuild + restart web.
  ...(SEO_NOINDEX ? { robots: NOINDEX_ROBOTS } : {}),
};

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  // Parallel route slot. Populated by <app/@modal/...> segments — see
  // app/@modal/(.)listing/[id]/page.tsx for the intercepted listing modal.
  // Always renders; the slot's default.tsx returns null when no match.
  modal: React.ReactNode;
}) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
      </head>
      <body
        className={`${figtree.variable} ${bricolage.variable} font-sans antialiased`}
        data-testid="app-body"
      >
        <NuqsAdapter>
          <ThemeProvider>
            <QueryProvider>
              {children}
              {modal}
              {/* Global modals — mounted once at the root so the Navbar
                  Bell/Flag buttons work on every page (incl. /listing/[id]
                  and /watchdog/manage). Without this, clicks set a Zustand
                  flag with no listener, then the modals would pop up
                  stacked when the user later landed on a page that
                  happened to mount them. */}
              <WatchdogModal />
              <ReportProblemModal />
            </QueryProvider>
          </ThemeProvider>
        </NuqsAdapter>

        {/* Google Analytics 4 — set NEXT_PUBLIC_GA_MEASUREMENT_ID in .env to enable.
            send_page_view is off so <AnalyticsListener> can fire a page_view on
            every pathname+search change (including ?listing=N modal opens). */}
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
              `}
            </Script>
            <Suspense fallback={null}>
              <AnalyticsListener />
            </Suspense>
          </>
        )}
      </body>
    </html>
  );
}
