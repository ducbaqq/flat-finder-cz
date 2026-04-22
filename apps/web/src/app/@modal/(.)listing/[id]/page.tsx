import { fetchClusterSiblings, fetchListing } from "@/lib/listing-server";
import InterceptedListingModal from "./InterceptedListingModal";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Intercepted-route segment for /listing/[id]. When a user clicks a listing
 * on /search (or the homepage), Next.js intercepts the navigation and
 * renders this component in the @modal slot — instead of replacing the
 * page with the full-page detail route.
 *
 * The URL still changes to /listing/[id], so:
 *   - AnalyticsListener fires page_view (it watches pathname)
 *   - Sharing the URL works (refreshing lands on the full page)
 *   - Back button closes the modal (history entry is the previous /search?...)
 */
export default async function InterceptedListingPage({ params }: PageProps) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) return null;

  // Unlike the full page, we don't call notFound() here — that would
  // replace the entire app shell with the 404 UI for what should be a
  // dismissible overlay. We pass listing=null down and the client
  // component renders a small error state inside the dialog.
  const [listing, siblings] = await Promise.all([
    fetchListing(id).catch(() => null),
    fetchClusterSiblings(id),
  ]);

  return <InterceptedListingModal listing={listing} siblings={siblings} />;
}
