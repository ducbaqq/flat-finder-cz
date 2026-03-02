import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { count } from "drizzle-orm";
import { getDb, listings } from "@flat-finder/db";

import { errorHandler } from "./middleware/error-handler.js";
import listingsRoutes from "./routes/listings.js";
import markersRoutes from "./routes/markers.js";
import statsRoutes from "./routes/stats.js";
import watchdogsRoutes from "./routes/watchdogs.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Error handler
app.onError(errorHandler);

// Routes
app.route("/api/listings", listingsRoutes);
app.route("/api/markers", markersRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/watchdogs", watchdogsRoutes);

// Health route at /api/health
app.get("/api/health", async (c) => {
  const db = getDb();

  const [totalResult, bySourceRows] = await Promise.all([
    db.select({ count: count() }).from(listings),
    db
      .select({ source: listings.source, count: count() })
      .from(listings)
      .groupBy(listings.source),
  ]);

  const total = totalResult[0]?.count ?? 0;
  const by_source: Record<string, number> = {};
  for (const row of bySourceRows) {
    by_source[row.source] = row.count;
  }

  return c.json({ status: "ok", total, by_source });
});

// Start server
const port = 4000;

serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Flat Finder CZ API server running on http://localhost:${port}`,
  );
});

export default app;
