import { Hono } from "hono";
import { z } from "zod";
import {
  getDb,
  createWatchdog,
  getWatchdogsByEmail,
  toggleWatchdog,
  deleteWatchdog,
} from "@flat-finder/db";
import type { Watchdog } from "@flat-finder/types";

const app = new Hono();

// ── API-13: Strip HTML tags to prevent XSS in labels ──
function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}

const createWatchdogSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .refine((val) => val.includes("@"), "Valid email is required"),
  filters: z.record(z.unknown()).default({}),
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

  // API-13: Sanitize label to strip HTML tags
  const sanitizedLabel = label ? stripHtmlTags(label) : null;

  const row = await createWatchdog(db, {
    email,
    filters,
    label: sanitizedLabel || null,
  });

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
 * GET /api/watchdogs — List watchdogs by email
 */
app.get("/", async (c) => {
  const db = getDb();
  const email = c.req.query("email");

  if (!email) {
    return c.json({ error: "Email parameter required" }, 400);
  }

  const rows = await getWatchdogsByEmail(db, email);

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
