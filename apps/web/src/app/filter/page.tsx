"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { FilterPageForm } from "@/components/filter-page/FilterPageForm";

function FilterPageContent() {
  const searchParams = useSearchParams();
  const propertyType = searchParams.get("property_type") || undefined;
  const transactionType = searchParams.get("transaction_type") || undefined;

  return (
    <div className="min-h-screen bg-[#F0F0F0]">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="rounded-3xl bg-white p-6 shadow-lg sm:p-10">
          <h1 className="mb-8 text-center text-2xl font-bold text-[#232B3A]">
            Vyhledat nemovitost
          </h1>
          <FilterPageForm
            initialPropertyType={propertyType}
            initialTransactionType={transactionType}
          />
        </div>
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
