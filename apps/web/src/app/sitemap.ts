import type { MetadataRoute } from "next";

const BASE_URL = "https://domov.cz";

const popularCities = [
  "Praha",
  "Brno",
  "Ostrava",
  "Plzen",
  "Liberec",
  "Olomouc",
  "Ceske-Budejovice",
  "Hradec-Kralove",
  "Pardubice",
  "Zlin",
  "Karlovy-Vary",
  "Usti-nad-Labem",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${BASE_URL}/search`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.9,
    },
  ];

  const cityPages: MetadataRoute.Sitemap = popularCities.map((city) => ({
    url: `${BASE_URL}/search?city=${encodeURIComponent(city)}`,
    lastModified: new Date(),
    changeFrequency: "hourly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...cityPages];
}
