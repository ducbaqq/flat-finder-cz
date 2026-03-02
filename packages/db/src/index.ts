export { getDb, closeDb, type Db } from "./client.js";
export { listings, type ListingRow, type NewListing } from "./schema/listings.js";
export { watchdogs, type WatchdogRow, type NewWatchdog } from "./schema/watchdogs.js";
export {
  scraperRuns,
  type ScraperRunRow,
  type NewScraperRun,
} from "./schema/scraper-runs.js";
export * from "./queries/listings.js";
export * from "./queries/watchdogs.js";
export * from "./queries/scraper-runs.js";
