import type { Metadata } from "next";
import { Inter, DM_Serif_Display } from "next/font/google";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const dmSerif = DM_Serif_Display({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Domov.cz — Najděte svůj nový domov",
    template: "%s | Domov.cz",
  },
  description:
    "Hledáte byt nebo dům v Česku? Domov.cz prohledává všechny největší realitní portály na jednom místě — sreality.cz, bezrealitky.cz, ulovdomov.cz a další.",
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
  authors: [{ name: "Domov.cz" }],
  metadataBase: new URL("https://domov.cz"),
  openGraph: {
    type: "website",
    locale: "cs_CZ",
    url: "https://domov.cz",
    siteName: "Domov.cz",
    title: "Domov.cz — Najděte svůj nový domov",
    description:
      "Prohledávejte všechny největší české realitní portály na jednom místě. Byty, domy, pronájem i prodej.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Domov.cz — Najděte svůj nový domov",
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
        className={`${inter.variable} ${dmSerif.variable} font-sans antialiased`}
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
