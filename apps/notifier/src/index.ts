import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { getEnv } from "@flat-finder/config";
import {
  getDb,
  closeDb,
  getActiveWatchdogs,
  getClusterSiblings,
  watchdogs as watchdogsTable,
  watchdogNotifications as watchdogNotificationsTable,
  type ListingRow,
  type WatchdogRow,
} from "@flat-finder/db";
import type { ListingFilters } from "@flat-finder/types";
import { sendBrevoEmail } from "./brevo.js";
import { findMatchingListings } from "./matcher.js";
import { humanReadableSourceName } from "./sources.js";
import { composeFilterSummary, composeMoreUrl } from "./summary.js";
import { signTokenUrl } from "./tokens.js";
import { composeSubject } from "./subject.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cap rendered listings per email at 10 (matcher returns up to 21). */
const DISPLAYED_PER_EMAIL = 10;

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

/**
 * Format price Czech-style: "25 000 Kč" or "25 000 Kč/měs."
 * Uses non-breaking spaces as thousands separator.
 */
export function formatPrice(
  price: number | null | undefined,
  currency = "CZK",
  transactionType?: string | null,
): string {
  if (price == null) {
    return "Cena na vyžádání";
  }

  const rounded = Math.round(price);
  // Format with commas then replace with non-breaking spaces
  const formatted = rounded.toLocaleString("en-US").replace(/,/g, " ");
  const suffix = transactionType === "rent" ? "Kč/měs." : "Kč";
  return `${formatted} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Cluster_key computation
// ---------------------------------------------------------------------------

/**
 * Worker-side cluster_key derivation. Mirrors the SQL COALESCE the matcher
 * uses, so the row we insert into watchdog_notifications is the same key
 * the next cycle's anti-join will look up.
 */
function clusterKeyForListing(listing: ListingRow): string {
  return listing.cluster_id
    ? `cluster:${listing.cluster_id}`
    : `singleton:${listing.id}`;
}

// ---------------------------------------------------------------------------
// Listing → email entry
// ---------------------------------------------------------------------------

interface ListingEmailEntry {
  title: string;
  price_formatted: string;
  size_m2: number | null;
  layout: string | null;
  address: string;
  thumbnail_url: string | null;
  detail_url: string;
  sources: Array<{ name: string; url: string }>;
  /**
   * The canonical source's display name pre-flattened. Brevo's Jinja
   * variant chokes on `{{ listing.sources[0].name }}` (bracket-then-attr
   * chaining) — having the value at top level lets the template just
   * write `{{ listing.canonical_source_name }}`.
   */
  canonical_source_name: string;
  /**
   * Editorial index label "01", "02", … pre-formatted for the template.
   * Brevo's Jinja subset doesn't expose `loop.index`, so the previous
   * `{% if loop.index < 10 %}0{% endif %}{{ loop.index }}` rendered "00"
   * for every listing.
   */
  position_label: string;
  transaction_label: string;
}

/**
 * Build the per-listing dict the new template renders. `sources` lists
 * every distinct portal the listing appeared on (canonical first, then
 * the rest); when the listing has no cluster, just the row's own source.
 */
async function buildListingEmailEntry(
  db: ReturnType<typeof getDb>,
  listing: ListingRow,
  appBaseUrl: string,
): Promise<ListingEmailEntry> {
  const detailUrl = `${appBaseUrl.replace(/\/+$/, "")}/listing/${listing.id}`;
  const transactionLabel =
    listing.transaction_type === "rent" ? "Pronájem" : "Prodej";

  const sources: Array<{ name: string; url: string }> = [];

  if (listing.cluster_id) {
    const siblings = await getClusterSiblings(db, listing.id);
    // siblings are sorted by price asc; we want canonical first, then rest.
    const canonical = siblings.filter((s) => s.is_canonical);
    const rest = siblings.filter((s) => !s.is_canonical);
    for (const s of [...canonical, ...rest]) {
      if (!s.source_url) continue;
      sources.push({
        name: humanReadableSourceName(s.source),
        url: s.source_url,
      });
    }
  }

  // Fallback (no cluster, or cluster query returned nothing usable): use
  // the listing's own source row so the card can still render "Také na".
  if (sources.length === 0) {
    sources.push({
      name: humanReadableSourceName(listing.source),
      url: listing.source_url ?? "",
    });
  }

  return {
    title: listing.title ?? "Bez názvu",
    price_formatted:
      formatPrice(listing.price, listing.currency ?? "CZK", listing.transaction_type) ||
      "Cena na dotaz",
    size_m2: listing.size_m2 ?? null,
    layout: listing.layout,
    address: listing.address ?? listing.city ?? "",
    thumbnail_url: listing.thumbnail_url,
    detail_url: detailUrl,
    sources,
    canonical_source_name: sources[0]?.name ?? "",
    position_label: "", // assigned by the caller using its loop index
    transaction_label: transactionLabel,
  };
}

// ---------------------------------------------------------------------------
// Summary entry
// ---------------------------------------------------------------------------

interface SummaryEntry {
  watchdog_id: number;
  email: string;
  listing_count: number;
  sent: boolean;
  dry_run: boolean;
  timestamp: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main notifier logic
// ---------------------------------------------------------------------------

/**
 * Run one notification cycle. Returns a summary list of actions taken.
 */
async function runNotifier(dryRun: boolean): Promise<SummaryEntry[]> {
  const env = getEnv();
  const db = getDb();
  const summary: SummaryEntry[] = [];

  const watchdogList = await getActiveWatchdogs(db);

  if (watchdogList.length === 0) {
    console.log("[INFO] No active watchdogs found");
    return summary;
  }

  console.log(`[INFO] Processing ${watchdogList.length} active watchdogs`);

  for (const wdog of watchdogList) {
    await processWatchdog(wdog, dryRun, env, db, summary);
  }

  return summary;
}

async function processWatchdog(
  wdog: WatchdogRow,
  dryRun: boolean,
  env: ReturnType<typeof getEnv>,
  db: ReturnType<typeof getDb>,
  summary: SummaryEntry[],
): Promise<void> {
  const wdogId = wdog.id;
  const email = wdog.email;
  const filters: ListingFilters = (wdog.filters as ListingFilters | null) ?? {};

  let matchResult: { listings: ListingRow[]; hasMore: boolean };
  try {
    matchResult = await findMatchingListings(db, wdog);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[ERROR] Watchdog #${wdogId} (${email}): matcher failed — ${message}`,
    );
    summary.push({
      watchdog_id: wdogId,
      email,
      listing_count: 0,
      sent: false,
      dry_run: dryRun,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      error: `matcher: ${message}`,
    });
    return;
  }

  const { listings: matchedListings, hasMore } = matchResult;

  if (matchedListings.length === 0) {
    console.log(
      `[DEBUG] Watchdog #${wdogId} (${email}): 0 new listings since ${wdog.last_notified_at ?? wdog.created_at}`,
    );
    return;
  }

  // Cap displayed at DISPLAYED_PER_EMAIL; the matcher already capped at 21.
  const displayedListings = matchedListings.slice(0, DISPLAYED_PER_EMAIL);
  const totalCount = matchedListings.length; // ≤ 21 — drives "and N more" copy

  const filtersSummary = composeFilterSummary(filters, null);
  const subject = composeSubject(displayedListings.length, filtersSummary);

  const listingEntries: ListingEmailEntry[] = [];
  for (let i = 0; i < displayedListings.length; i++) {
    const entry = await buildListingEmailEntry(
      db,
      displayedListings[i],
      env.APP_BASE_URL,
    );
    // Pre-formatted "01" / "02" / … editorial index labels — Brevo Jinja
    // doesn't expose loop.index, so we compute on the worker side.
    entry.position_label = String(i + 1).padStart(2, "0");
    listingEntries.push(entry);
  }

  const templateParams: Record<string, unknown> = {
    watchdog_label: wdog.label || filtersSummary,
    watchdog_filters_summary: filtersSummary,
    total_count: totalCount,
    displayed_count: displayedListings.length,
    has_more: hasMore,
    more_url: hasMore ? composeMoreUrl(env.APP_BASE_URL, filters) : "",
    app_url: env.APP_BASE_URL,
    unsubscribe_url: signTokenUrl(wdogId, "unsubscribe"),
    pause_url: signTokenUrl(wdogId, "pause"),
    manage_url: signTokenUrl(wdogId, "manage"),
    recipient_email: email,
    listings: listingEntries,
  };

  const entry: SummaryEntry = {
    watchdog_id: wdogId,
    email,
    listing_count: totalCount,
    sent: false,
    dry_run: dryRun,
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  if (dryRun) {
    console.log(
      `[INFO] DRY RUN — Watchdog #${wdogId} (${email}): ${displayedListings.length} listings (has_more=${hasMore})`,
    );
    entry.sent = true;
    summary.push(entry);
    return;
  }

  if (!env.BREVO_API_KEY) {
    console.error(
      "[ERROR] BREVO_API_KEY not set — cannot send email. Use --dry-run to test.",
    );
    entry.error = "BREVO_API_KEY not set";
    summary.push(entry);
    return;
  }

  try {
    await sendBrevoEmail(email, env.BREVO_TEMPLATE_ID, templateParams, {
      subject,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "brevo_send_failed",
        watchdog_id: wdogId,
        email,
        error: message,
      }),
    );
    entry.error = message;
    summary.push(entry);
    return;
  }

  // Brevo 2xx — atomic commit: insert audit rows + bump last_notified_at.
  // Either the whole tx commits or neither side moves; cluster_key dedup
  // guarantees the worst-case redo is a duplicate, never a silent miss.
  const clusterKeys = displayedListings.map(clusterKeyForListing);
  const emailCanonical = wdog.email_canonical;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  try {
    await db.transaction(async (tx) => {
      if (clusterKeys.length > 0) {
        // Drizzle's `sql` template spreads JS arrays into a row constructor
        // (`($1, $2)`) rather than a Postgres `text[]`, so the previous
        // `unnest(${clusterKeys}::text[])` form was invalid SQL. Use the
        // `.insert(...).values(rows).onConflictDoNothing()` builder instead
        // — it batches into a single multi-row INSERT and gets the array
        // binding right.
        await tx
          .insert(watchdogNotificationsTable)
          .values(
            clusterKeys.map((cluster_key) => ({
              email_canonical: emailCanonical,
              cluster_key,
            })),
          )
          .onConflictDoNothing();
      }
      await tx.execute(sql`
        UPDATE ${watchdogsTable}
        SET last_notified_at = ${now}
        WHERE id = ${wdogId}
      `);
    });
  } catch (error) {
    // Rare: send succeeded but DB write failed. The user will get one
    // duplicate next cycle — preferable to a silent miss. Log loudly so
    // it's noticed.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "audit_commit_failed_after_send",
        watchdog_id: wdogId,
        email,
        error: message,
      }),
    );
  }

  entry.sent = true;
  console.log(
    `[INFO] Watchdog #${wdogId} (${email}): sent ${displayedListings.length}/${totalCount} listings, audit + last_notified_at committed`,
  );
  summary.push(entry);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      loop: { type: "boolean", default: false },
      interval: { type: "string", default: "1800" },
      "dry-run": { type: "boolean", default: false },
      "json-summary": { type: "boolean", default: false },
    },
    strict: true,
  });

  const loop = values.loop ?? false;
  const interval = parseInt(values.interval ?? "1800", 10);
  const dryRun = values["dry-run"] ?? false;
  const jsonSummary = values["json-summary"] ?? false;

  console.log(
    `[INFO] Notifier starting (dry_run=${dryRun}, loop=${loop}, interval=${interval}s)`,
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const summary = await runNotifier(dryRun);

      if (jsonSummary) {
        console.log(JSON.stringify(summary, null, 2));
      }

      const sent = summary.filter((s) => s.sent).length;
      console.log(
        `[INFO] Run complete: ${summary.length} watchdogs processed, ${sent} emails sent`,
      );
    } catch (error) {
      console.error("[ERROR] Error during notifier run:", error);
    }

    if (!loop) {
      break;
    }

    console.log(`[INFO] Sleeping ${interval} seconds until next run`);
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }

  await closeDb();
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
