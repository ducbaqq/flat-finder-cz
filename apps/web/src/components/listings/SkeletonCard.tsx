"use client";

export default function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-img" />
      <div className="skeleton-text w70" />
      <div className="skeleton-text w50" />
      <div className="skeleton-text w30" />
    </div>
  );
}
