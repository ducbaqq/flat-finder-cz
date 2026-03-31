import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "@flat-finder/db";

import { errorHandler } from "./middleware/error-handler.js";
import listingsRoutes from "./routes/listings.js";
import markersRoutes, { startMarkerRefresh, stopMarkerRefresh } from "./routes/markers.js";
import statsRoutes, { startStatsRefresh, stopStatsRefresh } from "./routes/stats.js";
import watchdogsRoutes from "./routes/watchdogs.js";
import suggestRoutes from "./routes/suggest.js";

const app = new Hono();

// ── API-14: Security headers ──
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// ── API-05: HTTP compression ──
app.use("*", compress());

// ── API-06: CORS with specific origins ──
const allowedOrigins = [
  "https://domov.cz",
  "https://www.domov.cz",
  "http://localhost:3000",
  "http://localhost:3001",
];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:4000");
}
app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

// ── API-07: In-memory sliding window rate limiter ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_GET = 100;
const RATE_LIMIT_MUTATION = 10;

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000).unref();

app.use("*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const method = c.req.method;
  const isMutation = method === "POST" || method === "PATCH" || method === "DELETE";
  const limit = isMutation ? RATE_LIMIT_MUTATION : RATE_LIMIT_GET;
  const key = `${ip}:${isMutation ? "mut" : "get"}`;

  const now = Date.now();
  let entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(key, entry);
  }

  entry.count++;

  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
  c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > limit) {
    return c.json({ error: "Too many requests. Please try again later." }, 429);
  }

  await next();
});

app.use("*", logger());

// ── API-09: Body size limit for POST routes ──
app.use("/api/watchdogs", bodyLimit({ maxSize: 50 * 1024 })); // 50KB

// Error handler
app.onError(errorHandler);

// Routes
app.route("/api/listings", listingsRoutes);
app.route("/api/markers", markersRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/watchdogs", watchdogsRoutes);
app.route("/api/suggest", suggestRoutes);

// ── API-02: Lightweight health check with simple SELECT 1 ──
app.get("/api/health", async (c) => {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok" });
  } catch (err) {
    return c.json({ status: "error", message: "Database connection failed" }, 503);
  }
});

// Start server
const port = 4000;

const prewarmAbort = new AbortController();

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Flat Finder CZ API server running on http://localhost:${port}`,
  );

  // Start the background stats refresh (computes once immediately, then every 15min).
  startStatsRefresh();

  // Start the background marker cluster refresh (computes once immediately, then every 15min).
  // This replaces the old 107s+ Supercluster in-memory index build.
  startMarkerRefresh().catch((err) =>
    console.error("[marker-refresh] startup failed:", err),
  );

  // Pre-warm other caches sequentially so we don't saturate the small DB pool.
  const signal = prewarmAbort.signal;
  (async () => {
    try {
      const base = `http://localhost:${port}`;

      if (signal.aborted) return;

      console.log("Pre-warming listings cache…");
      await fetch(`${base}/api/listings?per_page=20&sort=newest`, { signal });
      console.log("Listings cache warmed.");
    } catch (e) {
      if (!signal.aborted) console.error("Cache pre-warm failed:", e);
    }
  })();
});

// Graceful shutdown so tsx watch can restart cleanly
function shutdown() {
  console.log("Shutting down…");
  prewarmAbort.abort();
  stopStatsRefresh();
  stopMarkerRefresh();
  server.close(() => void 0);
  closeDb().finally(() => process.exit(0));
  // Hard exit if cleanup hangs
  setTimeout(() => process.exit(1), 2000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
