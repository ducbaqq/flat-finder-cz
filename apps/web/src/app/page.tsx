"use client";

import TopBar from "@/components/layout/TopBar";
import Sidebar from "@/components/layout/Sidebar";
import MainContent from "@/components/layout/MainContent";
import DetailModal from "@/components/detail/DetailModal";
import WatchdogModal from "@/components/watchdog/WatchdogModal";
import { useFilterStore } from "@/store/filter-store";
import { useWatchdogs } from "@/hooks/useWatchdogs";

export default function HomePage() {
  const total = useFilterStore((s) => s.total);
  const { activeCount } = useWatchdogs();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          padding: "8px",
          background: "var(--color-primary)",
          color: "#fff",
          zIndex: 9999,
        }}
      >
        Skip to content
      </a>
      <div className="dashboard">
        <TopBar watchdogBadgeCount={activeCount} totalListings={total} />
        <Sidebar />
        <MainContent />
      </div>
      <DetailModal />
      <WatchdogModal />
    </>
  );
}
