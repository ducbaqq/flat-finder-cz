"use client";

import { useStats } from "@/hooks/useStats";

export function HeroSection({ children }: { children: React.ReactNode }) {
  const { data } = useStats();
  const totalListings = data?.total ?? 0;

  return (
    <section
      className="flex flex-col items-center pt-12 pb-8 px-4"
      data-testid="hero-section"
    >
      {/* App Logo - big centered */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#CC0000] text-2xl font-bold text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          D
        </div>
        <span
          className="text-3xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Domov.cz
        </span>
      </div>

      {/* Headline with count */}
      <h1
        className="text-center text-xl sm:text-2xl font-medium text-[#232B3A] mb-8"
        data-testid="hero-title"
      >
        Vyberte si z{" "}
        <strong className="font-bold">
          {totalListings.toLocaleString("cs-CZ")} nabídek
        </strong>{" "}
        nemovitostí
      </h1>

      {/* Children: PropertyTypeTabs + QuickActions */}
      <div className="w-full max-w-4xl">{children}</div>
    </section>
  );
}
