"use client";

import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { useStats } from "@/hooks/useStats";
import { Building2, Globe } from "lucide-react";

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
  ];

  return (
    <div ref={ref} className="mt-12" data-testid="trust-bar">
      <motion.div
        className="flex items-center justify-center gap-8 sm:gap-16"
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        {stats.map(({ icon: Icon, value, label }, i) => (
          <div
            key={label}
            className="stagger-item flex items-center gap-3"
            style={{ animationDelay: `${i * 100}ms` }}
            data-testid="trust-bar-stat"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-bold font-display" data-testid="trust-bar-stat-value">
                <AnimatedCounter value={value} />
              </div>
              <div className="text-xs text-muted-foreground" data-testid="trust-bar-stat-label">{label}</div>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
