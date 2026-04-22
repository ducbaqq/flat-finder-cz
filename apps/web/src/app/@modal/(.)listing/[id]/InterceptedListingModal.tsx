"use client";

import { useRouter } from "next/navigation";
import type { Listing, ClusterSibling } from "@flat-finder/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ListingDetailContent from "@/components/detail/ListingDetailContent";

interface Props {
  listing: Listing | null;
  siblings: ClusterSibling[];
}

/**
 * Client wrapper that mounts ListingDetailContent inside a shadcn Dialog.
 *
 * The `open` prop is driven by the mere presence of this component in the
 * parallel-route tree — when the user navigates away (back button, router
 * push), Next un-mounts it. When `onOpenChange(false)` fires (ESC, backdrop
 * click, close button), we router.back() to restore the previous URL; this
 * preserves any ?view=map&location=... search state the user had.
 */
export default function InterceptedListingModal({ listing, siblings }: Props) {
  const router = useRouter();

  const handleClose = () => {
    // router.back() restores the exact previous entry — URL + scroll
    // position + search state. Beats router.push("/search") which would
    // drop filter/map state the user spent time building.
    router.back();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-4xl gap-0 overflow-hidden rounded-xl border-divider p-0"
        data-testid="listing-detail-modal"
      >
        <DialogTitle className="sr-only">
          {listing?.title || "Detail nabídky"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Detail nemovitosti{listing?.title ? ` — ${listing.title}` : ""}
        </DialogDescription>
        <ScrollArea className="max-h-[90vh]">
          {listing ? (
            <ListingDetailContent listing={listing} siblings={siblings} />
          ) : (
            <div className="p-8 text-center" data-testid="listing-detail-error">
              <p
                className="text-destructive"
                data-testid="listing-detail-error-message"
              >
                Nepodařilo se načíst detail nabídky.
              </p>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
