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

  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleMapCollapsed: () => void;
  setMapBounds: (bounds: MapBounds | null) => void;
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

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleMapCollapsed: () => set((s) => ({ mapCollapsed: !s.mapCollapsed })),
  setMapBounds: (bounds) => set({ mapBounds: bounds }),
  openDetail: (id) => set({ selectedListingId: id, detailModalOpen: true }),
  closeDetail: () => set({ selectedListingId: null, detailModalOpen: false }),
  toggleWatchdogModal: () =>
    set((s) => ({ watchdogModalOpen: !s.watchdogModalOpen })),
  closeWatchdogModal: () => set({ watchdogModalOpen: false }),
}));
