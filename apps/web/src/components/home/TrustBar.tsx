"use client";

import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { useStats } from "@/hooks/useStats";
import { Building2, Globe, MapPin } from "lucide-react";

function AnimatedCounter({ value }: { value: number }) {
  return (
    <span className="tabular-nums">
      {value.toLocaleString("cs-CZ")}
    </span>
  );
}

export function TrustBar() {
  const { data } = useStats();
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.3 });

  if (!data) return null;

  const topCities = Object.entries(data.by_city || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  const stats = [
    {
      icon: Building2,
      value: data.total,
      label: "aktivních nabídek",
    },
    {
      icon: Globe,
      value: Object.keys(data.by_source || {}).length,
      label: "zdrojových portálů",
    },
    {
      icon: MapPin,
      value: Object.keys(data.by_city || {}).length,
      label: "měst",
    },
  ];

  return (
    <section ref={ref} className="border-y bg-muted/30 py-8">
      <div className="mx-auto max-w-5xl px-4">
        <motion.div
          className="flex flex-wrap items-center justify-center gap-8 sm:gap-12"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          {stats.map(({ icon: Icon, value, label }) => (
            <div key={label} className="flex items-center gap-3 text-center">
              <Icon className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">
                  <AnimatedCounter value={value} />
                </div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
