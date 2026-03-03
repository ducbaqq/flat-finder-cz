"use client";

import Link from "next/link";
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
    <section ref={ref} className="py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Prozkoumejte města
          </h2>
          <p className="mt-2 text-muted-foreground">
            Nejpopulárnější lokality s nabídkami
          </p>
        </div>

        <motion.div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:gap-6"
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
        >
          {cities.map(([city, count]) => (
            <motion.div key={city} variants={fadeInUp}>
              <Link
                href={`/search?location=${encodeURIComponent(city)}`}
                className="group relative block overflow-hidden rounded-xl bg-gradient-to-br from-primary/80 to-primary/40 p-6 transition-transform hover:scale-[1.03]"
              >
                <div className="relative z-10">
                  <h3 className="text-lg font-bold text-white sm:text-xl">
                    {city}
                  </h3>
                  <p className="mt-1 text-sm text-white/80">
                    {count.toLocaleString("cs-CZ")} nabídek
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
