import { and, desc, eq, isNull, not, sql } from "drizzle-orm";
import { watchdogs, type NewWatchdog, type WatchdogRow } from "../schema/watchdogs.js";
import type { Db } from "../client.js";

export async function createWatchdog(
  db: Db,
  data: NewWatchdog,
): Promise<WatchdogRow> {
  const result = await db.insert(watchdogs).values(data).returning();
  return result[0];
}

export async function getWatchdogsByEmail(
  db: Db,
  email: string,
): Promise<WatchdogRow[]> {
  return db
    .select()
    .from(watchdogs)
    .where(eq(watchdogs.email, email))
    .orderBy(desc(watchdogs.created_at));
}

/**
 * Lookup-by-canonical, the GET endpoint's preferred path: ensures
 * `Foo@Gmail.com` and `foo@gmail.com` find the same row.
 *
 * Excludes soft-deleted rows — from the user's perspective those
 * watchdogs no longer exist, so they don't show up in "Moji hlídači".
 */
export async function getWatchdogsByCanonicalEmail(
  db: Db,
  emailCanonical: string,
): Promise<WatchdogRow[]> {
  return db
    .select()
    .from(watchdogs)
    .where(
      and(
        eq(watchdogs.email_canonical, emailCanonical),
        isNull(watchdogs.deleted_at),
      ),
    )
    .orderBy(desc(watchdogs.created_at));
}

/**
 * Returns the active, non-deleted row for this canonical email, or null.
 * Used by the POST handler to short-circuit before INSERT (the partial
 * unique index is the ultimate guard for the TOCTOU window between this
 * check and INSERT). Soft-deleted rows have `active = false` so the
 * partial unique index already excludes them — but we add the explicit
 * `deleted_at IS NULL` here for clarity / defense in depth.
 */
export async function findActiveWatchdogByCanonical(
  db: Db,
  emailCanonical: string,
): Promise<WatchdogRow | null> {
  const rows = await db
    .select()
    .from(watchdogs)
    .where(
      and(
        eq(watchdogs.email_canonical, emailCanonical),
        eq(watchdogs.active, true),
        isNull(watchdogs.deleted_at),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveWatchdogs(db: Db): Promise<WatchdogRow[]> {
  return db
    .select()
    .from(watchdogs)
    .where(and(eq(watchdogs.active, true), isNull(watchdogs.deleted_at)));
}

export async function toggleWatchdog(
  db: Db,
  id: number,
): Promise<{ active: boolean | null } | null> {
  const result = await db
    .update(watchdogs)
    .set({ active: not(watchdogs.active) })
    .where(eq(watchdogs.id, id))
    .returning({ active: watchdogs.active });
  return result[0] ?? null;
}

/**
 * Soft-delete: flip `active = false` AND stamp `deleted_at = now()`.
 *
 * From the user's perspective the watchdog is gone — no more emails,
 * hidden from "Moji hlídači", email_canonical freed for fresh signup.
 * The row stays in the DB so we can audit historical activity.
 *
 * Idempotent: a second call against an already-deleted row is a no-op
 * but still returns true (the row exists).
 */
export async function deleteWatchdog(db: Db, id: number): Promise<boolean> {
  const result = await db
    .update(watchdogs)
    .set({ active: false, deleted_at: sql`NOW()` })
    .where(eq(watchdogs.id, id))
    .returning({ id: watchdogs.id });
  return result.length > 0;
}

export async function updateLastNotifiedAt(
  db: Db,
  id: number,
  timestamp: string,
): Promise<void> {
  await db
    .update(watchdogs)
    .set({ last_notified_at: timestamp })
    .where(eq(watchdogs.id, id));
}

/**
 * Postgres unique-violation code. Surfaced by drizzle/postgres-js as a
 * `cause` carrying `{ code: '23505' }` — the API layer uses this to
 * convert a TOCTOU race into a 409 instead of a 500.
 */
export const PG_UNIQUE_VIOLATION = "23505";

/** Helper: detect a Postgres unique-violation regardless of how the
 * driver wraps the error. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === PG_UNIQUE_VIOLATION || e.cause?.code === PG_UNIQUE_VIOLATION;
}

