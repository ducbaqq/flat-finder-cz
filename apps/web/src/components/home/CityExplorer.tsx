"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { useStats } from "@/hooks/useStats";
import { fadeInUp, staggerContainer } from "@/lib/animations";

export function CityExplorer() {
  const { data } = useStats();
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });

  if (!data) return null;

  const cities = Object.entries(data.by_city || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  if (cities.length === 0) return null;

  return (
    <section ref={ref} className="py-16 sm:py-20" data-testid="city-explorer-section">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 text-center">
          <h2
            className="font-display font-normal"
            style={{ fontSize: "var(--text-3xl)" }}
            data-testid="city-explorer-title"
          >
            Prozkoumejte města
          </h2>
          <p className="mt-2 text-muted-foreground" data-testid="city-explorer-subtitle">
            Nejpopulárnější lokality s nabídkami
          </p>
        </div>

        <motion.div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:gap-6"
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          data-testid="city-explorer-grid"
        >
          {cities.map(([city, count]) => (
            <motion.div key={city} variants={fadeInUp}>
              <Link
                href={`/search?location=${encodeURIComponent(city)}`}
                className="group relative block overflow-hidden rounded-xl border border-divider bg-card p-6 transition-all hover:shadow-md hover:border-primary/30"
                data-testid="city-card"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold font-display" data-testid="city-card-name">
                  {city}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground" data-testid="city-card-count">
                  {count.toLocaleString("cs-CZ")} nabídek
                </p>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
