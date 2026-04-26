import { and, desc, eq, not } from "drizzle-orm";
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
 */
export async function getWatchdogsByCanonicalEmail(
  db: Db,
  emailCanonical: string,
): Promise<WatchdogRow[]> {
  return db
    .select()
    .from(watchdogs)
    .where(eq(watchdogs.email_canonical, emailCanonical))
    .orderBy(desc(watchdogs.created_at));
}

/**
 * Returns the active row for this canonical email, or null. Used by the
 * POST handler to short-circuit before INSERT (the partial unique index is
 * the ultimate guard for the TOCTOU window between this check and INSERT).
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
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveWatchdogs(db: Db): Promise<WatchdogRow[]> {
  return db.select().from(watchdogs).where(eq(watchdogs.active, true));
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

export async function deleteWatchdog(db: Db, id: number): Promise<boolean> {
  const result = await db
    .delete(watchdogs)
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

