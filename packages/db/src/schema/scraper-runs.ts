import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const scraperRuns = pgTable("scraper_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  started_at: timestamp("started_at", { mode: "string" }).defaultNow(),
  finished_at: timestamp("finished_at", { mode: "string" }),
  new_count: integer("new_count").default(0),
  updated_count: integer("updated_count").default(0),
  error_count: integer("error_count").default(0),
  deactivated_count: integer("deactivated_count").default(0),
  elapsed_ms: integer("elapsed_ms"),
  status: text("status").default("running"),
  error_message: text("error_message"),
});

export type ScraperRunRow = typeof scraperRuns.$inferSelect;
export type NewScraperRun = typeof scraperRuns.$inferInsert;
