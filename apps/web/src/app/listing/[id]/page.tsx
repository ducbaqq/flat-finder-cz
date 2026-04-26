import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import ListingDetailContent from "@/components/detail/ListingDetailContent";
import {
  buildListingDescription,
  buildListingJsonLd,
  buildListingTitle,
  fetchClusterSiblings,
  fetchListing,
  SITE_URL,
} from "@/lib/listing-server";
import { SEO_NOINDEX } from "@/lib/seo";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return { title: "Nabídka nenalezena" };
  }

  const listing = await fetchListing(id).catch(() => null);
  if (!listing) {
    return {
      title: "Nabídka nenalezena",
      robots: { index: false, follow: false },
    };
  }

  const title = buildListingTitle(listing);
  const description = buildListingDescription(listing);
  const canonical = `${SITE_URL}/listing/${listing.id}`;
  const images = ((listing.image_urls || []).slice(0, 3).length > 0
    ? listing.image_urls.slice(0, 3)
    : listing.thumbnail_url
      ? [listing.thumbnail_url]
      : []);

  // Inactive listings are still reachable (users may share old URLs) but we
  // don't want them in the search index. The page UI renders a "no longer
  // active" banner; the robots meta here prevents indexing.
  // SEO_NOINDEX (lib/seo.ts) shadows the active-listing branch too, so the
  // global kill switch covers every listing detail page during pause windows.
  const robotsMeta =
    SEO_NOINDEX || !listing.is_active
      ? { index: false, follow: false }
      : { index: true, follow: true };

  return {
    title,
    description,
    alternates: { canonical },
    robots: robotsMeta,
    openGraph: {
      type: "website",
      siteName: "Bytomat.cz",
      locale: "cs_CZ",
      url: canonical,
      title,
      description,
      images: images.map((url) => ({ url })),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  };
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const listing = await fetchListing(id);
  if (!listing) notFound();

  // Siblings are non-blocking for SEO — we fetch them alongside the listing
  // so the first paint of the Dostupné na N portálech strip doesn't flash
  // empty. Soft-fails to [] when unavailable.
  const siblings = await fetchClusterSiblings(id);

  const jsonLd = buildListingJsonLd(listing);
  const title = buildListingTitle(listing);

  return (
    <div className="flex min-h-screen flex-col" data-testid="listing-detail-page">
      <Navbar />

      <main className="flex-1 pb-16">
        <div className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6 sm:pt-8">
          <nav aria-label="Drobečková navigace" className="mb-4">
            <Link
              href="/search"
              prefetch={false}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              data-testid="listing-detail-back"
            >
              <ChevronLeft className="h-4 w-4" />
              Zpět na výsledky
            </Link>
          </nav>

          {!listing.is_active && (
            <div
              className="mb-5 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground"
              data-testid="listing-inactive-banner"
              role="status"
            >
              Tato nabídka již není aktivní. Zobrazená data odpovídají
              poslednímu záznamu z&nbsp;portálu.
            </div>
          )}

          <article
            className="overflow-hidden rounded-xl border border-divider bg-card"
            data-testid="listing-detail-article"
          >
            <h1 className="sr-only">{title}</h1>
            <ListingDetailContent listing={listing} siblings={siblings} />
          </article>
        </div>
      </main>

      <Footer />
      <MobileBottomNav />

      {/* Structured data — rendered as a literal script tag so crawlers pick
          it up on the HTML response. Using dangerouslySetInnerHTML is the
          documented Next pattern for JSON-LD; value is JSON-stringified
          from a typed object above so injection is not a concern. */}
      <script
        type="application/ld+json"
        suppressHydrationWarning
        data-testid="listing-jsonld"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
