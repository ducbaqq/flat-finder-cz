import { parseArgs } from "node:util";
import { getEnv } from "@flat-finder/config";
import {
  getDb,
  closeDb,
  getActiveWatchdogs,
  updateLastNotifiedAt,
  type ListingRow,
  type WatchdogRow,
} from "@flat-finder/db";
import { sendBrevoEmail } from "./brevo.js";
import { findMatchingListings } from "./matcher.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LISTINGS_PER_EMAIL = 20;

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

/**
 * Format price Czech-style: "25 000 Kc" or "25 000 Kc/mes."
 * Uses non-breaking spaces as thousands separator.
 */
export function formatPrice(
  price: number | null | undefined,
  currency = "CZK",
  transactionType?: string | null,
): string {
  if (price == null) {
    return "Cena na vy\u017E\u00E1d\u00E1n\u00ED";
  }

  const rounded = Math.round(price);
  // Format with commas then replace with non-breaking spaces
  const formatted = rounded.toLocaleString("en-US").replace(/,/g, "\u00A0");
  const suffix = transactionType === "rent" ? "K\u010D/m\u011Bs." : "K\u010D";
  return `${formatted} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Listing -> email template params
// ---------------------------------------------------------------------------

interface ListingEmailParams {
  title: string;
  price_formatted: string;
  city: string;
  size_m2: number | string;
  layout: string;
  property_type: string;
  transaction_type: string;
  source: string;
  thumbnail_url: string;
  listing_url: string;
  source_url: string;
}

/**
 * Convert a DB listing row to a dict suitable for Brevo template params.
 */
export function listingToEmailParams(row: ListingRow): ListingEmailParams {
  const listingUrl = row.source_url ?? "";
  return {
    title: row.title ?? "Bez n\u00E1zvu",
    price_formatted: formatPrice(row.price, row.currency ?? "CZK", row.transaction_type),
    city: row.city ?? "",
    size_m2: row.size_m2 ?? "",
    layout: row.layout ?? "",
    property_type: row.property_type ?? "",
    transaction_type: row.transaction_type ?? "",
    source: row.source ?? "",
    thumbnail_url: row.thumbnail_url ?? "",
    listing_url: listingUrl,
    source_url: listingUrl,
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
    const wdogId = wdog.id;
    const email = wdog.email;
    const label = wdog.label ?? `Hl\u00EDda\u010D #${wdogId}`;

    // Find matching listings since last notification
    const { total, listings: matchedListings } = await findMatchingListings(db, wdog);

    if (total === 0) {
      console.log(
        `[DEBUG] Watchdog #${wdogId} (${email}): 0 new listings since ${wdog.last_notified_at ?? wdog.created_at}`,
      );
      continue;
    }

    const hasMore = total > MAX_LISTINGS_PER_EMAIL;
    const listingsToSend = matchedListings.slice(0, MAX_LISTINGS_PER_EMAIL);
    const extraCount = hasMore ? total - MAX_LISTINGS_PER_EMAIL : 0;

    const listingParams = listingsToSend.map(listingToEmailParams);

    const templateParams = {
      watchdog_label: label,
      listing_count: total,
      has_more: hasMore,
      extra_count: extraCount,
      listings: listingParams,
      app_url: env.APP_BASE_URL,
    };

    const entry: SummaryEntry = {
      watchdog_id: wdogId,
      email,
      listing_count: total,
      sent: false,
      dry_run: dryRun,
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    };

    if (dryRun) {
      console.log(
        `[INFO] DRY RUN \u2014 Watchdog #${wdogId} (${email}): ${total} new listings (has_more=${hasMore}, extra=${extraCount})`,
      );
      entry.sent = true;
    } else {
      if (!env.BREVO_API_KEY) {
        console.error(
          "[ERROR] BREVO_API_KEY not set \u2014 cannot send email. Use --dry-run to test.",
        );
        entry.error = "BREVO_API_KEY not set";
      } else {
        const success = await sendBrevoEmail(
          email,
          env.BREVO_TEMPLATE_ID,
          templateParams,
        );
        entry.sent = success;

        if (success) {
          const now = new Date().toISOString().replace("T", " ").slice(0, 19);
          await updateLastNotifiedAt(db, wdogId, now);
          console.log(
            `[INFO] Watchdog #${wdogId} (${email}): sent ${total} listings, updated last_notified_at`,
          );
        } else {
          console.warn(
            `[WARN] Watchdog #${wdogId} (${email}): email send failed, skipping last_notified_at update`,
          );
        }
      }
    }

    summary.push(entry);
  }

  return summary;
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
