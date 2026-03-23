"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { FilterPageForm } from "@/components/filter-page/FilterPageForm";
import { fadeInUp } from "@/lib/animations";

function FilterPageContent() {
  const searchParams = useSearchParams();
  const propertyType = searchParams.get("property_type") || undefined;
  const transactionType = searchParams.get("transaction_type") || undefined;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <motion.div
          className="rounded-2xl bg-card p-6 shadow-lg shadow-foreground/5 border border-border sm:p-10"
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
        >
          <h1 className="mb-8 text-center font-display text-2xl font-normal text-foreground">
            Vyhledat nemovitost
          </h1>
          <FilterPageForm
            initialPropertyType={propertyType}
            initialTransactionType={transactionType}
          />
        </motion.div>
      </div>
      <Footer />
      <MobileBottomNav />
    </div>
  );
}

export default function FilterPage() {
  return (
    <Suspense>
      <FilterPageContent />
    </Suspense>
  );
}
