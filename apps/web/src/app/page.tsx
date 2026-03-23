"use client";

import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { HeroSection } from "@/components/home/HeroSection";
import { SearchTabs } from "@/components/home/SearchTabs";
import { TrustBar } from "@/components/home/TrustBar";
import { LatestListings } from "@/components/home/LatestListings";
import { FeaturesSection } from "@/components/home/FeaturesSection";
import { CityExplorer } from "@/components/home/CityExplorer";
import DetailModal from "@/components/detail/DetailModal";
import WatchdogModal from "@/components/watchdog/WatchdogModal";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main data-testid="home-page">
        <HeroSection>
          <SearchTabs />
          <TrustBar />
        </HeroSection>
        <LatestListings />
        <FeaturesSection />
        <CityExplorer />
      </main>
      <Footer />
      <MobileBottomNav />
      <DetailModal />
      <WatchdogModal />
    </>
  );
}
