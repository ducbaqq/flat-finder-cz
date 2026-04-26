import {
  boolean,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const watchdogs = pgTable(
  "watchdogs",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    email_canonical: text("email_canonical").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    label: text("label"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at", { mode: "string" }).defaultNow(),
    last_notified_at: timestamp("last_notified_at", { mode: "string" }),
    /**
     * Soft-delete marker. NOT NULL = the watchdog has been deleted from
     * the user's perspective (no more emails, hidden from their list).
     * The row stays in the DB for audit/history. Combined with
     * active=false on soft-delete so the partial unique index frees the
     * email_canonical for a fresh signup.
     */
    deleted_at: timestamp("deleted_at", { mode: "string" }),
  },
  (table) => [
    index("idx_watchdogs_email").on(table.email),
    index("idx_watchdogs_active").on(table.active),
  ],
);

export type WatchdogRow = typeof watchdogs.$inferSelect;
export type NewWatchdog = typeof watchdogs.$inferInsert;
