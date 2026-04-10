"use client";

import { motion } from "framer-motion";
import { useStats } from "@/hooks/useStats";

export function HeroSection({ children }: { children: React.ReactNode }) {
  const { data } = useStats();
  const totalListings = data?.total ?? 0;
  const sourcesCount = Object.keys(data?.by_source ?? {}).length;

  return (
    <section
      className="relative flex flex-col items-center px-4 pb-8 pt-12 sm:pt-20 sm:pb-12"
      data-testid="hero-section"
    >
      {/* Headline */}
      <motion.h1
        className="font-display text-center font-semibold tracking-tight text-foreground"
        style={{ fontSize: "var(--text-hero)", lineHeight: 1 }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        Najděte svůj
        <br />
        <span className="text-primary">nový domov</span>
      </motion.h1>

      <motion.p
        className="mt-4 max-w-md text-center text-muted-foreground sm:mt-5"
        style={{ fontSize: "var(--text-lg)" }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        {totalListings > 0 ? (
          <>
            <span className="font-medium text-foreground tabular-nums">
              {totalListings.toLocaleString("cs-CZ")}
            </span>{" "}
            nabídek z{" "}
            <span className="font-medium text-foreground tabular-nums">
              {sourcesCount}
            </span>{" "}
            portálů na jednom místě
          </>
        ) : (
          "Prohledáváme všechny české realitní portály na jednom místě"
        )}
      </motion.p>

      {/* Children: PropertyTypeTabs + QuickActions */}
      <motion.div
        className="mt-8 w-full max-w-2xl sm:mt-10"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </section>
  );
}
