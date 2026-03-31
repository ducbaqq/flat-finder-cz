import { Hono } from "hono";

const app = new Hono();

// ── In-memory cache ──
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60_000; // 60 seconds
const MAX_CACHE_SIZE = 500;

app.get("/", async (c) => {
  const query = c.req.query("query")?.trim() ?? "";

  // Validate
  if (!query || query.length < 2) {
    return c.json({ items: [] });
  }
  if (query.length > 150) {
    return c.json({ error: "Query too long" }, 400);
  }

  // Check cache
  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return c.json(cached.data);
  }

  // Call Mapy.cz Suggest API
  const apiKey = process.env.SEZNAM_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Suggest service not configured" }, 503);
  }

  const params = new URLSearchParams({
    query,
    lang: "cs",
    limit: "7",
    type: "regional.municipality,regional.municipality_part,regional.street,regional.address",
    locality: "cz",
  });

  try {
    const res = await fetch(`https://api.mapy.cz/v1/suggest?${params}`, {
      headers: { "X-Mapy-Api-Key": apiKey },
    });

    if (!res.ok) {
      console.error(`Mapy.cz suggest error: ${res.status}`);
      return c.json({ error: "Suggest service unavailable" }, 502);
    }

    const data = await res.json();

    // Cache result
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { data, ts: Date.now() });

    return c.json(data);
  } catch (err) {
    console.error("Mapy.cz suggest fetch error:", err);
    return c.json({ error: "Suggest service unavailable" }, 502);
  }
});

export default app;
