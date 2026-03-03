"use client";

import { motion } from "framer-motion";
import { fadeInUp, staggerContainer } from "@/lib/animations";

export function HeroSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative flex min-h-[80vh] items-center justify-center overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      <motion.div
        className="relative z-10 mx-auto max-w-4xl px-4 text-center"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          variants={fadeInUp}
          className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl"
        >
          Najděte domov{" "}
          <span className="text-primary">bez starostí</span>
        </motion.h1>
        <motion.p
          variants={fadeInUp}
          className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground sm:text-xl"
        >
          Bez provize · Okamžité alerty · 3 zdroje na jednom místě
        </motion.p>
        <motion.div variants={fadeInUp} className="mt-8">
          {children}
        </motion.div>
      </motion.div>
    </section>
  );
}
