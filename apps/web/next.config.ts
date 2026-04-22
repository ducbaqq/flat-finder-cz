import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  // @flat-finder/db ships native node-postgres + uses import.meta.dirname
  // for CA-cert resolution. Webpack bundles it into the route chunk,
  // which both breaks the ESM-only "postgres" dep and loses the correct
  // dirname. Marking the workspace package as an external server package
  // keeps it at runtime require() and fixes both.
  serverExternalPackages: ["@flat-finder/db", "postgres", "drizzle-orm"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
