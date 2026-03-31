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
  selectedListingId: number | null;
  detailModalOpen: boolean;
  watchdogModalOpen: boolean;
  mapBounds: MapBounds | null;
  mapZoom: number | null;
  pendingBbox: [number, number, number, number] | null;

  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleMapCollapsed: () => void;
  setMapBounds: (bounds: MapBounds | null) => void;
  setMapZoom: (zoom: number) => void;
  setPendingBbox: (bbox: [number, number, number, number] | null) => void;
  openDetail: (id: number) => void;
  closeDetail: () => void;
  toggleWatchdogModal: () => void;
  closeWatchdogModal: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  mapCollapsed: false,
  selectedListingId: null,
  detailModalOpen: false,
  watchdogModalOpen: false,
  mapBounds: null,
  mapZoom: null,
  pendingBbox: null,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleMapCollapsed: () => set((s) => ({ mapCollapsed: !s.mapCollapsed })),
  setMapBounds: (bounds) => set({ mapBounds: bounds }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
  setPendingBbox: (bbox) => set({ pendingBbox: bbox }),
  openDetail: (id) => set({ selectedListingId: id, detailModalOpen: true }),
  closeDetail: () => set({ selectedListingId: null, detailModalOpen: false }),
  toggleWatchdogModal: () =>
    set((s) => ({ watchdogModalOpen: !s.watchdogModalOpen })),
  closeWatchdogModal: () => set({ watchdogModalOpen: false }),
}));
