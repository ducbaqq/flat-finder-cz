import { create } from "zustand";

export interface FilterValues {
  transaction_type: string;
  property_type: string;
  location: string;
  price_min: string;
  price_max: string;
  size_min: string;
  size_max: string;
  layout: string;
  condition: string;
  construction: string;
  ownership: string;
  furnishing: string;
  energy_rating: string;
  amenities: string;
  source: string;
  sort: string;
}

export interface MapBounds {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
}

export interface FilterState {
  filters: FilterValues;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  mapBounds: MapBounds | null;
  selectedListingId: number | null;
  sidebarOpen: boolean;
  watchdogModalOpen: boolean;
  detailModalOpen: boolean;
  mapCollapsed: boolean;

  setFilter: (key: keyof FilterValues, value: string) => void;
  setFilters: (filters: Partial<FilterValues>) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
  setMapBounds: (bounds: MapBounds | null) => void;
  setTotal: (total: number, totalPages: number) => void;
  openDetail: (id: number) => void;
  closeDetail: () => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleWatchdogModal: () => void;
  closeWatchdogModal: () => void;
  toggleMapCollapsed: () => void;
}

const defaultFilters: FilterValues = {
  transaction_type: "",
  property_type: "",
  location: "",
  price_min: "",
  price_max: "",
  size_min: "",
  size_max: "",
  layout: "",
  condition: "",
  construction: "",
  ownership: "",
  furnishing: "",
  energy_rating: "",
  amenities: "",
  source: "",
  sort: "newest",
};

export const useFilterStore = create<FilterState>((set) => ({
  filters: { ...defaultFilters },
  page: 1,
  perPage: 20,
  total: 0,
  totalPages: 0,
  mapBounds: null,
  selectedListingId: null,
  sidebarOpen: false,
  watchdogModalOpen: false,
  detailModalOpen: false,
  mapCollapsed: false,

  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
      page: 1,
    })),

  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters },
      page: 1,
    })),

  clearFilters: () =>
    set({
      filters: { ...defaultFilters },
      page: 1,
    }),

  setPage: (page) => set({ page }),

  setMapBounds: (bounds) => set({ mapBounds: bounds }),

  setTotal: (total, totalPages) => set({ total, totalPages }),

  openDetail: (id) => set({ selectedListingId: id, detailModalOpen: true }),

  closeDetail: () => set({ selectedListingId: null, detailModalOpen: false }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  closeSidebar: () => set({ sidebarOpen: false }),

  toggleWatchdogModal: () =>
    set((state) => ({ watchdogModalOpen: !state.watchdogModalOpen })),

  closeWatchdogModal: () => set({ watchdogModalOpen: false }),

  toggleMapCollapsed: () =>
    set((state) => ({ mapCollapsed: !state.mapCollapsed })),
}));
