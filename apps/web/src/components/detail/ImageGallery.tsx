"use client";

import { useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface ImageGalleryProps {
  images: string[];
}

const MAX_IMAGES = 3;

function EmptyGallery() {
  return (
    <div className="flex aspect-[16/9] items-center justify-center bg-muted" data-testid="image-gallery-empty">
      <span className="text-sm text-muted-foreground">Žádné fotky</span>
    </div>
  );
}

export default function ImageGallery({ images }: ImageGalleryProps) {
  const displayImages = images.slice(0, MAX_IMAGES);
  const [failedCount, setFailedCount] = useState(0);

  if (!displayImages.length) {
    return <EmptyGallery />;
  }

  if (failedCount >= displayImages.length) {
    return <EmptyGallery />;
  }

  return (
    <Carousel className="w-full" data-testid="image-gallery">
      <CarouselContent>
        {displayImages.map((url, i) => (
          <CarouselItem key={i} data-testid="image-gallery-slide">
            <div className="aspect-[16/9] overflow-hidden">
              <img
                className="h-full w-full object-cover"
                src={url}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  setFailedCount((c) => c + 1);
                }}
                data-testid="image-gallery-image"
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      {displayImages.length - failedCount > 1 && (
        <>
          <CarouselPrevious className="left-2" data-testid="image-gallery-prev" />
          <CarouselNext className="right-2" data-testid="image-gallery-next" />
        </>
      )}
    </Carousel>
  );
}
