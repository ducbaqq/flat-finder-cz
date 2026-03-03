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
      <div className="flex aspect-[16/9] items-center justify-center bg-muted">
        <span className="text-sm text-muted-foreground">Žádné fotky</span>
      </div>
    );
  }

  return (
    <Carousel className="w-full">
      <CarouselContent>
        {images.map((url, i) => (
          <CarouselItem key={i}>
            <div className="aspect-[16/9] overflow-hidden">
              <img
                className="h-full w-full object-cover"
                src={url}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      {images.length > 1 && (
        <>
          <CarouselPrevious className="left-2" />
          <CarouselNext className="right-2" />
        </>
      )}
    </Carousel>
  );
}
