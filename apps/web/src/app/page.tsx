"use client";

import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { HeroSection } from "@/components/home/HeroSection";
import { HomeFilterPanel } from "@/components/home/HomeFilterPanel";
import { LatestListings } from "@/components/home/LatestListings";
export default function HomePage() {
  return (
    <>
      <Navbar />
      <main data-testid="home-page">
        <HeroSection>
          <HomeFilterPanel />
        </HeroSection>
        <LatestListings />
      </main>
      <Footer />
      <MobileBottomNav />
      {/* WatchdogModal + ReportProblemModal + the @modal parallel slot
          (intercepted listing detail) are all mounted in app/layout.tsx. */}
    </>
  );
}
