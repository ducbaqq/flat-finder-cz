import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
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
  description:
    "Hledáte byt nebo dům v Česku? Bytomat.cz prohledává všechny největší realitní portály na jednom místě — sreality.cz, bezrealitky.cz, ulovdomov.cz a další.",
  keywords: [
    "byty",
    "domy",
    "pronájem",
    "prodej",
    "nemovitosti",
    "Česko",
    "Praha",
    "Brno",
    "sreality",
    "bezrealitky",
  ],
  authors: [{ name: "Bytomat.cz" }],
  metadataBase: new URL("https://bytomat.cz"),
  openGraph: {
    type: "website",
    locale: "cs_CZ",
    url: "https://bytomat.cz",
    siteName: "Bytomat.cz",
    title: "Bytomat.cz — Najděte svůj nový domov",
    description:
      "Prohledávejte všechny největší české realitní portály na jednom místě. Byty, domy, pronájem i prodej.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bytomat.cz — Najděte svůj nový domov",
    description:
      "Prohledávejte všechny největší české realitní portály na jednom místě.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// Replace with your actual GA4 Measurement ID when ready
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
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
            <QueryProvider>{children}</QueryProvider>
          </ThemeProvider>
        </NuqsAdapter>

        {/* Analytics: Google Analytics 4 — set NEXT_PUBLIC_GA_MEASUREMENT_ID env var to enable */}
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
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
