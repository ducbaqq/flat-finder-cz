export const PropertyType = {
  Flat: "flat",
  House: "house",
  Land: "land",
  Commercial: "commercial",
  Garage: "garage",
  Other: "other",
  Cottage: "cottage",
  ResidentialBuilding: "residential_building",
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

export const TransactionType = {
  Rent: "rent",
  Sale: "sale",
  Auction: "auction",
  Flatshare: "flatshare",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const Source = {
  Sreality: "sreality",
  Bezrealitky: "bezrealitky",
  UlovDomov: "ulovdomov",
  Bazos: "bazos",
  EReality: "ereality",
  Eurobydleni: "eurobydleni",
  CeskeReality: "ceskereality",
  RealityMix: "realitymix",
  Idnes: "idnes",
  Realingo: "realingo",
} as const;
export type Source = (typeof Source)[keyof typeof Source];

export const SortOption = {
  Newest: "newest",
  PriceAsc: "price_asc",
  PriceDesc: "price_desc",
  SizeAsc: "size_asc",
  SizeDesc: "size_desc",
} as const;
export type SortOption = (typeof SortOption)[keyof typeof SortOption];
