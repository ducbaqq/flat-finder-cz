"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface ImageGalleryProps {
  images: string[];
}

export default function ImageGallery({ images }: ImageGalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!images.length) return null;

  const scrollToIndex = useCallback(
    (index: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const children = container.children;
      if (index < 0 || index >= children.length) return;
      const child = children[index] as HTMLElement;
      container.scrollTo({
        left: child.offsetLeft - container.offsetLeft,
        behavior: "smooth",
      });
      setCurrentIndex(index);
    },
    []
  );

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const children = container.children;
    const scrollLeft = container.scrollLeft;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const dist = Math.abs(child.offsetLeft - container.offsetLeft - scrollLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    setCurrentIndex(closest);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const goPrev = useCallback(() => {
    scrollToIndex(Math.max(0, currentIndex - 1));
  }, [currentIndex, scrollToIndex]);

  const goNext = useCallback(() => {
    scrollToIndex(Math.min(images.length - 1, currentIndex + 1));
  }, [currentIndex, images.length, scrollToIndex]);

  return (
    <div className="gallery-wrapper">
      <div className="modal-gallery" ref={scrollRef}>
        {images.map((url, i) => (
          <img
            key={i}
            className="modal-gallery-img"
            src={url}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button
            className="gallery-nav prev"
            onClick={goPrev}
            disabled={currentIndex === 0}
            aria-label="Previous image"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className="gallery-nav next"
            onClick={goNext}
            disabled={currentIndex === images.length - 1}
            aria-label="Next image"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <span className="gallery-counter">
            {currentIndex + 1}/{images.length}
          </span>
        </>
      )}
    </div>
  );
}
