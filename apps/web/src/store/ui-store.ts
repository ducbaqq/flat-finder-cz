import { create } from "zustand";

export interface MapBounds {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
}

interface UiState {
  sidebarOpen: boolean;
  mapCollapsed: boolean;
  watchdogModalOpen: boolean;
  reportProblemModalOpen: boolean;
  mapBounds: MapBounds | null;
  mapZoom: number | null;
  pendingBbox: [number, number, number, number] | null;

  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleMapCollapsed: () => void;
  setMapBounds: (bounds: MapBounds | null) => void;
  setMapZoom: (zoom: number) => void;
  setPendingBbox: (bbox: [number, number, number, number] | null) => void;
  toggleWatchdogModal: () => void;
  closeWatchdogModal: () => void;
  openReportProblemModal: () => void;
  closeReportProblemModal: () => void;
}

/**
 * Listing detail is no longer held in this store. Navigation to a listing
 * is now driven by the URL — /listing/[id] — so callers push via
 * useRouter() from next/navigation. The @modal parallel slot intercepts
 * that navigation from internal pages and renders the detail as an
 * overlay; direct visits (Googlebot, shared links) hit the full SEO
 * page. See apps/web/src/app/@modal/(.)listing/[id]/page.tsx.
 */
export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  mapCollapsed: false,
  watchdogModalOpen: false,
  reportProblemModalOpen: false,
  mapBounds: null,
  mapZoom: null,
  pendingBbox: null,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleMapCollapsed: () => set((s) => ({ mapCollapsed: !s.mapCollapsed })),
  setMapBounds: (bounds) => set({ mapBounds: bounds }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
  setPendingBbox: (bbox) => set({ pendingBbox: bbox }),
  toggleWatchdogModal: () =>
    set((s) => {
      const opening = !s.watchdogModalOpen;
      const url = new URL(window.location.href);
      if (opening) {
        url.searchParams.set("watchdog", "1");
      } else {
        url.searchParams.delete("watchdog");
      }
      window.history.pushState(null, "", url.toString());
      return { watchdogModalOpen: opening };
    }),
  closeWatchdogModal: () => {
    set({ watchdogModalOpen: false });
    const url = new URL(window.location.href);
    url.searchParams.delete("watchdog");
    window.history.pushState(null, "", url.toString());
  },
  openReportProblemModal: () => set({ reportProblemModalOpen: true }),
  closeReportProblemModal: () => set({ reportProblemModalOpen: false }),
}));
