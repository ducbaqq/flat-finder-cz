"use client";

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

export default function ImageGallery({ images }: ImageGalleryProps) {
  if (!images.length) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center bg-muted" data-testid="image-gallery-empty">
        <span className="text-sm text-muted-foreground">Žádné fotky</span>
      </div>
    );
  }

  return (
    <Carousel className="w-full" data-testid="image-gallery">
      <CarouselContent>
        {images.map((url, i) => (
          <CarouselItem key={i} data-testid="image-gallery-slide">
            <div className="aspect-[16/9] overflow-hidden">
              <img
                className="h-full w-full object-cover"
                src={url}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
                data-testid="image-gallery-image"
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      {images.length > 1 && (
        <>
          <CarouselPrevious className="left-2" data-testid="image-gallery-prev" />
          <CarouselNext className="right-2" data-testid="image-gallery-next" />
        </>
      )}
    </Carousel>
  );
}
