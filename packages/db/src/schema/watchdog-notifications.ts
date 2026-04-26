import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Audit table. One row per (canonical email, cluster_key) the worker has
 * already mailed about. Written ONLY after a Brevo 2xx, in the same
 * transaction as the watchdogs.last_notified_at bump.
 *
 * `cluster_key` shape:
 *   - `cluster:<cluster_id>` when the listing is part of a cross-portal cluster
 *   - `singleton:<listing_id>` when it's not (still dedups the listing against itself)
 *
 * The pair PK ensures ON CONFLICT DO NOTHING idempotency; sent_at index
 * powers the future weekly retention sweep (>90d cleanup).
 */
export const watchdogNotifications = pgTable(
  "watchdog_notifications",
  {
    email_canonical: text("email_canonical").notNull(),
    cluster_key: text("cluster_key").notNull(),
    sent_at: timestamp("sent_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.email_canonical, table.cluster_key] }),
    index("idx_wn_sent_at").on(table.sent_at),
  ],
);

export type WatchdogNotificationRow =
  typeof watchdogNotifications.$inferSelect;
export type NewWatchdogNotification =
  typeof watchdogNotifications.$inferInsert;
