"use client";

import { motion } from "framer-motion";
import { useStats } from "@/hooks/useStats";
import { fadeInUp, staggerContainer } from "@/lib/animations";

export function HeroSection({ children }: { children: React.ReactNode }) {
  const { data } = useStats();
  const totalListings = data?.total ?? 0;

  return (
    <section className="relative flex min-h-[85vh] items-center justify-center overflow-hidden">
      {/* Warm radial gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-[var(--terracotta)]/5" />
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)",
          backgroundSize: "40px 40px",
        }}
      />

      <motion.div
        className="relative z-10 mx-auto max-w-5xl px-4 text-center"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* Eyebrow */}
        {totalListings > 0 && (
          <motion.div variants={fadeInUp} className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-sm font-medium text-primary">
              Přes {totalListings.toLocaleString("cs-CZ")} ověřených nabídek
            </span>
          </motion.div>
        )}

        <motion.h1
          variants={fadeInUp}
          className="font-display leading-[0.95] tracking-tight"
          style={{ fontSize: "var(--text-hero)" }}
        >
          Najděte domov{" "}
          <em className="text-primary not-italic" style={{ fontStyle: "italic" }}>
            bez starostí
          </em>
        </motion.h1>

        <motion.div variants={fadeInUp} className="mx-auto mt-6 max-w-2xl">
          <p className="text-muted-foreground">
            Prohledáváme všechny největší české portály na jednom místě
          </p>
        </motion.div>

        <motion.div variants={fadeInUp} className="mt-10">
          {children}
        </motion.div>
      </motion.div>
    </section>
  );
}
