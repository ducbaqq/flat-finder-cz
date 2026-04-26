export { getDb, closeDb, createDb, type Db } from "./client.js";
export { listings, type ListingRow, type NewListing } from "./schema/listings.js";
export { watchdogs, type WatchdogRow, type NewWatchdog } from "./schema/watchdogs.js";
export {
  watchdogNotifications,
  type WatchdogNotificationRow,
  type NewWatchdogNotification,
} from "./schema/watchdog-notifications.js";
export {
  scraperRuns,
  type ScraperRunRow,
  type NewScraperRun,
} from "./schema/scraper-runs.js";
export {
  listingStats,
  type ListingStatsRow,
} from "./schema/listing-stats.js";
export {
  markerClusters,
  type MarkerClusterRow,
} from "./schema/marker-clusters.js";
export * from "./queries/listings.js";
export * from "./queries/watchdogs.js";
export * from "./queries/watchdog-notifications.js";
export * from "./queries/scraper-runs.js";
export * from "./queries/listing-stats.js";
export * from "./queries/marker-clusters.js";
export { canonicalizeEmail } from "./utils/canonicalize-email.js";
