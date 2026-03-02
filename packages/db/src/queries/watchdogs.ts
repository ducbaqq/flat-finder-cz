import { desc, eq, not } from "drizzle-orm";
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
