"use client";

import { Search, Bell, Home } from "lucide-react";
import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { fadeInUp, staggerContainer } from "@/lib/animations";

const steps = [
  {
    icon: Search,
    title: "Hledejte",
    description:
      "Prohledávejte tisíce nabídek ze sreality.cz, bezrealitky.cz a ulovdomov.cz na jednom místě.",
  },
  {
    icon: Bell,
    title: "Nastavte alert",
    description:
      "Vytvořte si hlídacího psa a dostávejte e-mailové notifikace o nových nabídkách.",
  },
  {
    icon: Home,
    title: "Najděte domov",
    description:
      "Porovnávejte ceny, filtrujte podle parametrů a najděte ideální nemovitost.",
  },
];

export function HowItWorks() {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.2 });

  return (
    <section ref={ref} className="bg-muted/30 py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Jak to funguje</h2>
          <p className="mt-2 text-muted-foreground">
            Tři jednoduché kroky k novému bydlení
          </p>
        </div>

        <motion.div
          className="grid gap-8 sm:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
        >
          {steps.map(({ icon: Icon, title, description }, i) => (
            <motion.div
              key={title}
              variants={fadeInUp}
              className="relative text-center"
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <span className="absolute -top-2 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <h3 className="mb-2 text-lg font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
