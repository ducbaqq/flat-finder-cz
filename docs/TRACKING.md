# Bytomat.cz — Frontend Analytics & Tracking

> Single source of truth for what Bytomat fires to GA4, when, why, and how. Update this file in the same PR as any tracking code change.

## Stack

- **Provider:** Google Analytics 4 only. Measurement ID `G-KZV8YZ78RJ` (production), set via `NEXT_PUBLIC_GA_MEASUREMENT_ID` in the droplet's env. Locally unset → all events no-op.
- **Loader:** `apps/web/src/app/layout.tsx` injects `gtag.js` via `next/script` (`afterInteractive`) and runs `gtag('config', id, { send_page_view: false })` so GA's auto-pageview is **disabled** — `AnalyticsListener` is the sole `page_view` source.
- **Wrapper:** `apps/web/src/lib/analytics.ts` exports `trackPageView`, `trackEvent`, `sha256`, `getSurface`, and a `sanitizeLocation` helper used inside `trackPageView`.
- **Listener:** `apps/web/src/components/analytics/AnalyticsListener.tsx` is mounted in `RootLayout` and fires `page_view` on every pathname OR search-params change (so query-only navigations like modal opens and filter tweaks register).

## Privacy posture

- Bytomat has no auth. The only PII in the system is the **watchdog email**.
- Watchdog email is **never sent** to GA4 in any form, raw or hashed.
- The watchdog email-link (`/watchdog/manage?token=...`) carries an HMAC token. `sanitizeLocation` strips `?token` from `page_location` before any `page_view` is sent, so tokens cannot leak into GA reports.
- Watchdog row identifiers travel as `watchdog_id_hash = sha256(String(watchdogId))` — a stable, irreversible join key.
- All other params are listing- or filter-derived and contain no user-identifying data.

## Surface taxonomy

A `surface` param is attached to every event that could be initiated from multiple pages, so conversions can be attributed back to where the user came from. `getSurface()` derives it from `window.location.pathname`:

| Pathname prefix | `surface` value |
|---|---|
| `/` (exact) | `home` |
| `/search*` | `search` |
| `/listing/*` | `modal_listing` |
| `/watchdog/manage*` | `manage` |
| anything else | `other` |

Keep this list short — proliferating values dilutes GA4's exploration UI.

## Event reference

| Event | Shipped? | Where it fires (file:line) | Params | Notes |
|---|---|---|---|---|
| `page_view` | ✅ | `AnalyticsListener.tsx:18-23` | `page_path`, `page_location` (sanitized), `page_title` | Fires on every pathname OR search-params change. Auto-`page_view` is disabled in `gtag('config')`. |
| `listing_view` | ✅ | `ListingDetailContent.tsx:38-48` | `listing_id`, `source`, `property_type`, `transaction_type`, `city`, `price`, `cluster_id` | Rich detail-page event. Fires on hydration of the body, both for SSR `/listing/[id]` and the intercepted-route modal. **Gap:** no `surface` param yet — see [analytics-ga4-tracking-plan](../../../obsidian/projects/personal/flat-finder-cz/analytics-ga4-tracking-plan.md). |
| `watchdog_create` | ✅ | `WatchdogModal.tsx:handleSave` | `surface`, `filters_count` (int), `has_location` (bool), `has_price_range` (bool), `has_property_type` (bool) | Retention proxy. Filter values themselves are not duplicated here — they're already in `page_location`. |
| `watchdog_modal_open` | ✅ | `ui-store.ts:toggleWatchdogModal` | `surface` | Funnel step (intent → completion). Fires only on the open transition. |
| `watchdog_pause` | ✅ | `WatchdogModal.tsx:handleToggle` (modal) + `WatchdogManageTracking.tsx` (email link) | `entry: "modal" \| "email_link"`, `watchdog_id_hash` | User flips an active watchdog to inactive. From the email link this fires on `outcome.kind === "paused"`. |
| `watchdog_resume` | ✅ | `WatchdogModal.tsx:handleToggle` (modal only) | `entry: "modal"`, `watchdog_id_hash` | Reverse of pause. Email links don't carry a resume action. |
| `watchdog_delete` | ✅ | `WatchdogModal.tsx:handleDelete` (modal) + `WatchdogManageTracking.tsx` (email link) | `entry: "modal" \| "email_link"`, `watchdog_id_hash`, `result` (email link only: `"deleted" \| "already_deleted"`) | Soft-delete. The email-link path is dominant per [watchdog-soft-delete](../../../obsidian/projects/personal/flat-finder-cz/watchdog-soft-delete.md); `entry` lets you separate proactive in-app churn from passive email-link dismissals. |
| `outbound_click` | ⏳ planned | not yet wired — `SourcePills` anchor | `outbound_url`, `link_domain`, `is_sibling`, `siblings_count`, listing block | **Primary conversion.** Highest-priority remaining event. |
| `select_item` | ⏳ planned | not yet wired — `PropertyCard.onClick` | `surface`, `index`, listing block | Closes the click-attribution loop. |
| `view_item_list` | ⏳ planned | not yet wired — home `LatestListings` + `/search` results | `item_list_id` (`home_latest` / `search_results`), `item_list_name`, item count | Lets us compute CTR by surface. |
| `image_load_fail` | ⏳ planned | `PropertyCard.tsx` (final fallback) + `ImageGallery.tsx` | `source`, `cdn_host` | Quality signal — surfaces which source's CDNs rot fastest. Fires only on the **final** fallback failure, not each attempt. |
| `report_problem_submit` | ⏳ planned | `ReportProblemModal.tsx` | listing block, `reason` | Community quality signal. |

> **Legend:** ✅ shipped · ⏳ planned (specified in the GA4 tracking plan, not yet implemented)

## Standard listing param block

Every listing-touching event should attach this consistent shape (required fields bold):

| Param | Type | Source |
|---|---|---|
| **`listing_id`** | int | `listing.id` |
| **`source`** | string | `listing.source` (sreality / idnes / bazos / …) |
| **`property_type`** | string | `listing.property_type` |
| **`transaction_type`** | string | `listing.transaction_type` |
| `city` | string | `listing.city` |
| `region` | string | `listing.region` |
| `price` | number | `listing.price` |
| `layout` | string | `listing.layout` |
| `size_m2` | number | `listing.size_m2` |
| `has_gps` | bool | `latitude != null && longitude != null` |
| `cluster_id` | string | `listing.cluster_id` |
| **`surface`** | string | `getSurface()` — see surface taxonomy above |

## Custom dimensions / user properties (GA4 admin)

Set on every `page_view`. Sourced from `localStorage.searchPreferences` (`apps/web/src/hooks/useSearchPreferences.ts`).

- `default_view_preference` — `list` / `map` / `hybrid`
- `preferred_property_type` — comma-list from saved prefs
- `preferred_transaction_type` — `sale` / `rent`
- `has_active_watchdog` — best-effort bool, single-device since there's no auth. Set `true` on `watchdog_create`; reset on `watchdog_delete` of last one.

## Conversions (GA4 admin)

Mark these in **GA4 → Admin → Events → Mark as conversion**:

| Event | Tier |
|---|---|
| `outbound_click` | **Primary** — count every occurrence (not once per session). Multi-portal cluster click = multiple discrete value events. |
| `watchdog_create` | Secondary — retention proxy. |
| `report_problem_submit` | Tertiary (optional) — community-quality signal; don't optimize against it. |

## Recommended GA4 funnels (Explore → Funnel exploration)

1. **Home → Conversion:** `page_view (path=/)` → `view_item_list (item_list_id=home_latest)` → `select_item` → `view_item` (a.k.a. `listing_view`) → `outbound_click`. Segment by `surface` of `outbound_click`.
2. **Search → Conversion:** `page_view (path=/search)` → `filter_apply` → `view_item_list (item_list_id=search_results)` → `select_item` → `view_item` → `outbound_click`. Segment by view toggle to compare list vs map vs hybrid.
3. **View → Watchdog:** `view_item` → `watchdog_modal_open` → `watchdog_create`. Segment by `surface` to see whether modal-listing watchdog signups outperform search-page ones.
4. **Watchdog churn:** `watchdog_create` → (any session later) `watchdog_pause` or `watchdog_delete`. Segment by `entry`.

## What we deliberately don't track

- **Hover events, scroll-into-view of cards.** Aggregator users skim — there's no decision being made on hover.
- **Every URL update from nuqs.** `page_view` already covers this; firing a custom event per filter change drowns the signal.
- **Map zoom/pan beyond bbox change.** `map_bbox_change` (planned, rate-limited to 1/sec) is enough; raw zoom events are noise.
- **Modal close events.** Closing produces a `page_view` (URL drops `?listing=` or `?watchdog=1`). Inferring close from page_view is cheaper.
- **Static CTAs unless they're conversions.** "Otevřít vyhledávání" is a navigation — `page_view` covers it.
- **Synthetic e-commerce values** (revenue, currency on `purchase`). We're not e-commerce; using `view_item` / `select_item` for their analytical tooling is fine, but `purchase` would pollute revenue reports.

## Implementation conventions

- **Naming:** snake_case. Reuse GA4 e-commerce event names (`view_item`, `select_item`, `view_item_list`) where the semantics align — they unlock GA4's built-in e-commerce reports for free. Coin custom names (`watchdog_create`, `outbound_click`) where e-commerce semantics don't fit.
- **No `purchase` / `add_to_cart` / `begin_checkout` / `sign_up`.** Discussed in the tracking plan — `outbound_click` and `watchdog_create` are clearer for an aggregator.
- **All events fire client-side** via `trackEvent`. Server components (e.g. `/watchdog/manage`) hand off to a tiny client tracking component that runs on hydration.
- **No `await` on `trackEvent`** — gtag is fire-and-forget. The exception is `sha256`, which is async; await it before constructing the params object so the hash actually lands.
- **Lazy import of `analytics` from non-React modules** (e.g. `ui-store.ts`) to avoid pulling gtag into the SSR snapshot.
- **No PII in any event.** When in doubt, hash it. When still in doubt, drop it.

## Debugging

- **GA4 DebugView:** GA4 → Admin → DebugView. Append `?gtm_debug=1` or install GA Debug Chrome extension to see events live.
- **Console probe:** in production, run `dataLayer` in DevTools to see queued events.
- **Local dev:** events no-op (no `NEXT_PUBLIC_GA_MEASUREMENT_ID` in local env). To test the firing logic itself, monkey-patch:
  ```js
  window.gtag = (...args) => console.log('[gtag]', ...args);
  ```
- **BigQuery export:** if enabled in GA4 admin, raw event rows land in BigQuery within 24h — much better than GA UI for ad-hoc analysis.

## Cross-references

- Owner-facing recommendation document: [`obsidian/projects/personal/flat-finder-cz/analytics-ga4-tracking-plan.md`](../../../obsidian/projects/personal/flat-finder-cz/analytics-ga4-tracking-plan.md)
- Pageview architecture history: [`analytics-ga4-pageview.md`](../../../obsidian/projects/personal/flat-finder-cz/analytics-ga4-pageview.md)
- Watchdog soft-delete domain context: [`watchdog-soft-delete.md`](../../../obsidian/projects/personal/flat-finder-cz/watchdog-soft-delete.md)
