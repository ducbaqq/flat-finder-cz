"use client";

import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { HeroSection } from "@/components/home/HeroSection";
import { PropertyTypeTabs } from "@/components/home/PropertyTypeTabs";
import { QuickActions } from "@/components/home/QuickActions";
import { LatestListings } from "@/components/home/LatestListings";
import WatchdogModal from "@/components/watchdog/WatchdogModal";
import ReportProblemModal from "@/components/report-problem/ReportProblemModal";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main data-testid="home-page">
        <HeroSection>
          <PropertyTypeTabs />
          <QuickActions />
        </HeroSection>
        <LatestListings />
      </main>
      <Footer />
      <MobileBottomNav />
      {/* Listing detail modal is served by the @modal parallel slot —
          see app/@modal/(.)listing/[id]/page.tsx. */}
      <WatchdogModal />
      <ReportProblemModal />
    </>
  );
}
