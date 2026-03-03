"use client";

import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { HeroSection } from "@/components/home/HeroSection";
import { SearchTabs } from "@/components/home/SearchTabs";
import { TrustBar } from "@/components/home/TrustBar";
import { LatestListings } from "@/components/home/LatestListings";
import { HowItWorks } from "@/components/home/HowItWorks";
import { CityExplorer } from "@/components/home/CityExplorer";
import DetailModal from "@/components/detail/DetailModal";
import WatchdogModal from "@/components/watchdog/WatchdogModal";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection>
          <SearchTabs />
        </HeroSection>
        <TrustBar />
        <LatestListings />
        <HowItWorks />
        <CityExplorer />
      </main>
      <Footer />
      <MobileBottomNav />
      <DetailModal />
      <WatchdogModal />
    </>
  );
}
