"use client";

import { Shield, CheckCircle, Bell } from "lucide-react";
import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { fadeInUp, staggerContainer } from "@/lib/animations";

const features = [
  {
    icon: Shield,
    color: "bg-primary/10 text-primary",
    title: "Nulová provize",
    description:
      "Kontaktujte majitele přímo bez realitní kanceláře. Ušetříte desítky tisíc na provizích.",
  },
  {
    icon: CheckCircle,
    color: "bg-success/10 text-success",
    title: "Ověření majitelé",
    description:
      "Prověřeno oproti katastru nemovitostí. Víte, s kým jednáte, ještě před prohlídkou.",
  },
  {
    icon: Bell,
    color: "bg-[var(--terracotta)]/10 text-[var(--terracotta)]",
    title: "Okamžité alerty",
    description:
      "Nastavte si hlídacího psa a dostávejte okamžité notifikace o nových nabídkách.",
  },
];

export function FeaturesSection() {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.2 });

  return (
    <section ref={ref} className="bg-muted/30 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-12 text-center">
          <h2
            className="font-display font-normal"
            style={{ fontSize: "var(--text-3xl)" }}
          >
            Proč Domov.cz?
          </h2>
          <p className="mt-2 text-muted-foreground">
            Všechno, co potřebujete k nalezení nového bydlení
          </p>
        </div>

        <motion.div
          className="grid gap-6 sm:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
        >
          {features.map(({ icon: Icon, color, title, description }) => (
            <motion.div
              key={title}
              variants={fadeInUp}
              className="rounded-xl border border-divider bg-card p-8 text-center transition-shadow hover:shadow-md"
            >
              <div
                className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${color}`}
              >
                <Icon className="h-6 w-6" />
              </div>
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
