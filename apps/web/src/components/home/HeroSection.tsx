"use client";

import { motion } from "framer-motion";
import { useStats } from "@/hooks/useStats";
import { fadeInUp } from "@/lib/animations";

export function HeroSection({ children }: { children: React.ReactNode }) {
  const { data } = useStats();
  const totalListings = data?.total ?? 0;

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
        {/* Radial teal/terracotta glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(var(--primary)/0.08),transparent_70%)]" />
        {/* Subtle dot pattern texture */}
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

      {/* Headline with count */}
      <motion.h1
        className="text-center text-xl sm:text-2xl font-medium text-foreground mb-10"
        data-testid="hero-title"
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.15 }}
      >
        Vyberte si z{" "}
        <strong className="font-bold text-primary">
          {totalListings.toLocaleString("cs-CZ")} nabídek
        </strong>{" "}
        nemovitostí
      </motion.h1>

      {/* Children: PropertyTypeTabs + QuickActions */}
      <motion.div
        className="w-full max-w-4xl"
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.3 }}
      >
        {children}
      </motion.div>
    </section>
  );
}
