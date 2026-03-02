"use client";

import { useFilterStore } from "@/store/filter-store";
import type { RefObject } from "react";

interface PaginationProps {
  scrollTargetRef: RefObject<HTMLDivElement | null>;
}

export default function Pagination({ scrollTargetRef }: PaginationProps) {
  const page = useFilterStore((s) => s.page);
  const totalPages = useFilterStore((s) => s.totalPages);
  const total = useFilterStore((s) => s.total);
  const perPage = useFilterStore((s) => s.perPage);
  const setPage = useFilterStore((s) => s.setPage);

  if (totalPages <= 1) return null;

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  const maxVisible = 5;
  let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  const goTo = (p: number) => {
    if (p >= 1 && p <= totalPages && p !== page) {
      setPage(p);
      if (scrollTargetRef.current) {
        scrollTargetRef.current.scrollTop = 0;
      }
    }
  };

  const pages: (number | "ellipsis")[] = [];

  if (startPage > 1) {
    pages.push(1);
    if (startPage > 2) pages.push("ellipsis");
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) pages.push("ellipsis");
    pages.push(totalPages);
  }

  return (
    <div className="pagination">
      <span className="page-info">
        Zobrazeno {start}\u2013{end} z {total}
      </span>
      <button
        className="page-btn"
        disabled={page <= 1}
        onClick={() => goTo(page - 1)}
      >
        {"\u2039"}
      </button>
      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span
            key={`ellipsis-${i}`}
            className="page-btn"
            style={{ border: "none", cursor: "default" }}
          >
            {"\u2026"}
          </span>
        ) : (
          <button
            key={p}
            className={`page-btn${p === page ? " active" : ""}`}
            onClick={() => goTo(p)}
          >
            {p}
          </button>
        )
      )}
      <button
        className="page-btn"
        disabled={page >= totalPages}
        onClick={() => goTo(page + 1)}
      >
        {"\u203a"}
      </button>
    </div>
  );
}
