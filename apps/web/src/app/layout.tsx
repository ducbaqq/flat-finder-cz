import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import AnalyticsListener from "@/components/analytics/AnalyticsListener";
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
  // NOTE: robots defaults are now driven per-route. Listing detail pages
  // override via generateMetadata({robots}); pages that should stay out
  // of the index (e.g. /login, /filter) set it locally too. A site-wide
  // noindex here would defeat the whole SEO surface that
  // /listing/[id] + /sitemap.xml exist to create.
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
