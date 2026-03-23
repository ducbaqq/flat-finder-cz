"use client";

import { motion } from "framer-motion";
import { Building2, Globe } from "lucide-react";
import { useStats } from "@/hooks/useStats";
import { fadeInUp } from "@/lib/animations";

export function HeroSection({ children }: { children: React.ReactNode }) {
  const { data } = useStats();
  const totalListings = data?.total ?? 0;
  const sourcesCount = Object.keys(data?.by_source ?? {}).length;

  return (
    <section
      className="relative flex flex-col items-center pt-16 pb-10 px-4 overflow-hidden"
      data-testid="hero-section"
    >
      {/* Warm gradient background */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(var(--primary)/0.08),transparent_70%)]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      {/* App Logo - big centered */}
      <motion.div
        className="flex items-center gap-3 mb-8"
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
      >
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-lg shadow-primary/20"
          style={{ fontFamily: "var(--font-display)" }}
        >
          D
        </div>
        <span className="font-display text-3xl font-bold tracking-tight text-foreground">
          Domov.cz
        </span>
      </motion.div>

      {/* Children: PropertyTypeTabs + QuickActions */}
      <motion.div
        className="w-full max-w-4xl"
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.15 }}
      >
        {children}
      </motion.div>

      {/* Stats bar below filters */}
      {totalListings > 0 && (
        <motion.div
          className="mt-8 flex items-center justify-center gap-8 sm:gap-12 text-muted-foreground"
          data-testid="hero-stats"
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-lg font-bold text-foreground tabular-nums">
              {totalListings.toLocaleString("cs-CZ")}
            </span>
            <span className="text-sm">aktivních nabídek</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-lg font-bold text-foreground tabular-nums">
              {sourcesCount}
            </span>
            <span className="text-sm">zdrojů</span>
          </div>
        </motion.div>
      )}
    </section>
  );
}
