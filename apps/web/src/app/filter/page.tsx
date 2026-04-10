"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { FilterPageForm } from "@/components/filter-page/FilterPageForm";

function FilterPageContent() {
  const searchParams = useSearchParams();
  const propertyType = searchParams.get("property_type") || undefined;
  const transactionType = searchParams.get("transaction_type") || undefined;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1
            className="mb-10 text-center font-display font-semibold tracking-tight text-foreground"
            style={{ fontSize: "var(--text-2xl)" }}
          >
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
