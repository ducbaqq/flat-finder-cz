import { Hono } from "hono";
import { z } from "zod";
import {
  getDb,
  createWatchdog,
  getWatchdogsByCanonicalEmail,
  findActiveWatchdogByCanonical,
  toggleWatchdog,
  deleteWatchdog,
  isUniqueViolation,
  canonicalizeEmail,
} from "@flat-finder/db";
import type { Watchdog } from "@flat-finder/types";

const app = new Hono();

// ── API-13: Strip HTML tags to prevent XSS in labels ──
function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}

// ─── Filter validation ───────────────────────────────────────────────
//
// Mirrors `ListingFilters` in @flat-finder/types but with explicit numeric
// bounds and a strict object so unknown keys are rejected (typo in the
// frontend → 400, not silently-empty filter that matches everything).
const filtersSchema = z
  .object({
    property_type: z.string().optional(),
    transaction_type: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    source: z.string().optional(),
    layout: z.string().optional(),
    condition: z.string().optional(),
    construction: z.string().optional(),
    ownership: z.string().optional(),
    furnishing: z.string().optional(),
    energy_rating: z.string().optional(),
    amenities: z.string().optional(),
    location: z.string().optional(),
    price_min: z.number().nonnegative().optional(),
    price_max: z.number().nonnegative().optional(),
    size_min: z.number().nonnegative().optional(),
    size_max: z.number().nonnegative().optional(),
    sw_lat: z.number().min(-90).max(90).optional(),
    sw_lng: z.number().min(-180).max(180).optional(),
    ne_lat: z.number().min(-90).max(90).optional(),
    ne_lng: z.number().min(-180).max(180).optional(),
  })
  .strict();

type ParsedFilters = z.infer<typeof filtersSchema>;

/**
 * Reject pathological filters that would match "essentially everything"
 * and turn one watchdog row into an email storm.
 *
 *   - bbox area > 1000 km²
 *   - price spread > 10× (e.g. 1 Kč → 100 000 Kč)
 *   - size spread > 1000 m²
 */
function validateFilterShape(filters: ParsedFilters): string | null {
  // bbox area, only when all four corners present.
  if (
    filters.sw_lat != null &&
    filters.sw_lng != null &&
    filters.ne_lat != null &&
    filters.ne_lng != null
  ) {
    const dLat = filters.ne_lat - filters.sw_lat;
    const dLng = filters.ne_lng - filters.sw_lng;
    const midLat = (filters.ne_lat + filters.sw_lat) / 2;
    const cosMid = Math.cos((midLat * Math.PI) / 180);
    // 1° lat ≈ 111 km, 1° lng ≈ 111 km × cos(lat).
    const areaKm2 = Math.abs(dLat * 111 * dLng * 111 * cosMid);
    if (areaKm2 > 1000) {
      return "Zvolená oblast je příliš velká, zúžte ji.";
    }
  }

  if (
    filters.price_min != null &&
    filters.price_max != null &&
    filters.price_min > 0 &&
    filters.price_max / filters.price_min > 10
  ) {
    return "Cenové rozpětí je příliš široké.";
  }

  if (
    filters.size_min != null &&
    filters.size_max != null &&
    filters.size_max - filters.size_min > 1000
  ) {
    return "Rozsah plochy je příliš široký.";
  }

  return null;
}

const createWatchdogSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .refine((val) => val.includes("@"), "Valid email is required"),
  filters: filtersSchema.default({} as ParsedFilters),
  label: z.string().max(200, "Label must be 200 characters or less").optional(),
});

/**
 * POST /api/watchdogs — Create a new watchdog
 */
app.post("/", async (c) => {
  const db = getDb();
  const body = await c.req.json();

  const parsed = createWatchdogSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(", ");
    return c.json({ error: message }, 400);
  }

  const { email, filters, label } = parsed.data;

  // Reject pathological filters before they hit the DB or the matcher.
  const filterError = validateFilterShape(filters);
  if (filterError) {
    return c.json({ error: filterError }, 400);
  }

  let emailCanonical: string;
  try {
    emailCanonical = canonicalizeEmail(email);
  } catch {
    return c.json({ error: "Neplatná e-mailová adresa" }, 400);
  }

  // 1-active-watchdog-per-canonical-email. We do an explicit lookup so the
  // 99.9% non-racing case gets a clean 409 with a friendly Czech copy. The
  // DB partial unique index handles the remaining TOCTOU window.
  const existing = await findActiveWatchdogByCanonical(db, emailCanonical);
  if (existing) {
    return c.json(
      {
        error:
          "Pro tuto e-mailovou adresu už hlídač existuje. Smažte ten stávající nebo upravte filtry.",
      },
      409,
    );
  }

  // API-13: Sanitize label to strip HTML tags
  const sanitizedLabel = label ? stripHtmlTags(label) : null;

  let row;
  try {
    row = await createWatchdog(db, {
      email,
      email_canonical: emailCanonical,
      filters,
      label: sanitizedLabel || null,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        {
          error:
            "Pro tuto e-mailovou adresu už hlídač existuje. Smažte ten stávající nebo upravte filtry.",
        },
        409,
      );
    }
    throw err;
  }

  return c.json(
    {
      id: row.id,
      email: row.email,
      filters: row.filters,
      label: row.label,
      active: row.active ?? true,
    },
    201,
  );
});

/**
 * GET /api/watchdogs — List watchdogs by email (canonical lookup)
 */
app.get("/", async (c) => {
  const db = getDb();
  const email = c.req.query("email");

  if (!email) {
    return c.json({ error: "Email parameter required" }, 400);
  }

  let emailCanonical: string;
  try {
    emailCanonical = canonicalizeEmail(email);
  } catch {
    // A malformed query string is most likely a stale link, not an attack.
    // Empty list is the natural answer.
    return c.json({ watchdogs: [], total: 0 });
  }

  const rows = await getWatchdogsByCanonicalEmail(db, emailCanonical);

  const watchdogs: Watchdog[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    filters:
      typeof r.filters === "string"
        ? JSON.parse(r.filters as string)
        : r.filters ?? {},
    label: r.label,
    active: r.active ?? true,
    created_at: r.created_at ?? new Date().toISOString(),
    last_notified_at: r.last_notified_at,
  }));

  return c.json({ watchdogs, total: watchdogs.length });
});

/**
 * PATCH /api/watchdogs/:id/toggle — Toggle active/paused
 */
app.patch("/:id/toggle", async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ error: "Invalid watchdog ID" }, 400);
  }

  const result = await toggleWatchdog(db, id);

  // API-11: Return 404 if no rows were affected
  if (!result) {
    return c.json({ error: "Watchdog not found" }, 404);
  }

  return c.json({
    id,
    active: result.active ?? false,
  });
});

/**
 * DELETE /api/watchdogs/:id — Delete a watchdog
 */
app.delete("/:id", async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ error: "Invalid watchdog ID" }, 400);
  }

  const deleted = await deleteWatchdog(db, id);

  // API-11: Return 404 if no rows were affected
  if (!deleted) {
    return c.json({ error: "Watchdog not found" }, 404);
  }

  return c.json({ deleted: true });
});

export default app;
