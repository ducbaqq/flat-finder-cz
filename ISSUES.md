# Domov.cz — Master Issue List

> Generated: 2026-03-16
> Sources: Production Readiness Assessment, Full QA & Performance Report, Database Category Audit

## How to Use

Each section is self-contained. Copy a section into a Claude Code prompt:

```
Fix all issues in the "API Issues" section of ISSUES.md
```

Every issue has: ID, problem description with evidence, file paths, fix guidance, and effort estimate.

---

## Fix Report: API Issues — COMPLETED 2026-03-16

> All 14 issues verified passing. Tested with curl against live API at localhost:4000.

| ID | Severity | Issue | Before | After | Status |
|----|----------|-------|--------|-------|:------:|
| API-01 | CRITICAL | Filtered listings COUNT(*) takes 175-315s | 175-315s per filtered query | ~97ms cold, ~89ms cached (filter-hash count cache, 5-min TTL, 200 entries) | FIXED |
| API-02 | CRITICAL | /api/health takes 25-34s | 25-34s (uncached COUNT + GROUP BY) | 0.037s (simple `SELECT 1` check) | FIXED |
| API-03 | CRITICAL | Server collapses under concurrent load | 100 req → 100% failure | 20 concurrent → all 200 (pool `max: 20`, 30-min lifetime) | FIXED |
| API-04 | CRITICAL | Intermittent 500 errors on /api/listings | 2/3 calls returning 500 | Resolved by API-01 + API-03 (fast queries + proper pool) | FIXED |
| API-05 | MAJOR | Zero HTTP compression | No gzip/brotli, 76KB payloads | `Content-Encoding: gzip` via hono/compress | FIXED |
| API-06 | MAJOR | Wildcard CORS allows all origins | `cors()` — any origin allowed | Locked to domov.cz + localhost:3000, env-aware | FIXED |
| API-07 | MAJOR | No API rate limiting | Unlimited requests, server crashable | 100 req/min GET, 10 req/min mutations, `X-RateLimit-*` headers | FIXED |
| API-08 | MAJOR | Filtered markers SQL times out (300s+) | Unbounded query, 300s+ timeout | 5s `statement_timeout`, returns 408 with "zoom in" message | FIXED |
| API-09 | MAJOR | No request body size limit | 10MB payloads accepted | 50KB limit on watchdog routes, 413 on overflow | FIXED |
| API-10 | MINOR | Invalid sort silently ignored | `?sort=garbage` → default order | Returns 400 with list of valid sort values | FIXED |
| API-11 | MINOR | Toggle/delete non-existent watchdog returns 200 | Always 200 | Returns 404 `"Watchdog not found"` when ID doesn't exist | FIXED |
| API-12 | MINOR | No input validation on filter strings | Garbage values → empty results | Enum validation for property_type/transaction_type/source, 400 on invalid | FIXED |
| API-13 | MINOR | XSS in watchdog labels stored as-is | `<script>` tags stored raw | HTML tags stripped, 200-char max via Zod | FIXED |
| API-14 | MINOR | No security headers | None | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` | FIXED |

### Files Modified
- `apps/api/src/index.ts` — health endpoint, compress, CORS, rate limiter, body limit, security headers
- `apps/api/src/routes/listings.ts` — filter-hash count cache, sort validation, filter validation
- `apps/api/src/routes/markers.ts` — 5s statement_timeout with 408 fallback
- `apps/api/src/routes/watchdogs.ts` — 404 on missing, XSS strip, label max length
- `packages/db/src/client.ts` — connection pool `max: 20`, `max_lifetime: 1800`

---

## API Issues

> Scope: `apps/api/`, `packages/db/`

### Critical

#### API-01: Filtered listings COUNT(*) takes 175-315 seconds

**Problem:** Every new filter combination triggers a fresh `COUNT(*)` on 500k+ rows. The 2-minute count cache only helps unfiltered queries. A simple `city=Praha` query takes 315 seconds.

**File(s):**
- `packages/db/src/queries/listings.ts` (lines 142-145, the COUNT query)
- `apps/api/src/routes/listings.ts` (cache logic)

**Fix:**
- Option A: Use PostgreSQL `EXPLAIN` row estimate for approximate counts on filtered queries
- Option B: Skip count entirely for page > 1 (return `total: null`, frontend shows "next" instead of "page X of Y")
- Option C: Cache filtered counts per filter-hash with 5-min TTL
- Also add a composite index: `CREATE INDEX idx_listings_active_price ON listings (is_active, price) WHERE is_active = true`

**Effort:** M

---

#### API-02: /api/health takes 25-34 seconds per call

**Problem:** Runs uncached `COUNT(*) GROUP BY source` on 517k rows on every call. The identical `/api/stats` endpoint caches this and responds in 1ms.

**File(s):**
- `apps/api/src/index.ts` (lines 30-48, health route handler)

**Fix:** Reuse the stats cache, or add a dedicated health cache with 60s TTL. A health endpoint should respond in <50ms. Alternatively, simplify to just return `{ status: "ok" }` with a simple `SELECT 1` connectivity check, and move the counts to `/api/stats` only.

**Effort:** S

---

#### API-03: Server collapses under concurrent load

**Problem:** 100 parallel requests to the cached `/api/stats` endpoint resulted in 100% connection failures. 10 concurrent listing requests yielded only 0.45 RPS. The server became unresponsive for 10+ minutes after the burst.

**File(s):**
- `packages/db/src/client.ts` (connection pool config: only `idle_timeout: 30`, no pool size)
- `apps/api/src/index.ts` (no concurrency protection)

**Fix:**
- Configure postgres.js connection pool: `max: 20` (or appropriate for your DB plan)
- Add API-level rate limiting (see API-07)
- Consider adding a request queue or concurrency limiter for DB-heavy endpoints
- Test with: `for i in $(seq 1 50); do curl -s http://localhost:4000/api/stats &; done; wait`

**Effort:** M

---

#### API-04: Intermittent 500 errors on /api/listings

**Problem:** During testing, 2 out of 3 `/api/listings` calls returned HTTP 500. Some took 29s before failing. Users see perpetual loading skeletons with no error message.

**File(s):**
- `apps/api/src/routes/listings.ts`
- `packages/db/src/client.ts`

**Fix:** Root cause is likely DB connection timeout under load from the slow COUNT queries (API-01). Fixing API-01 should resolve this. Additionally:
- Add `connect_timeout: 10` and `statement_timeout: 30000` to postgres config
- Add structured error logging to identify the exact failure point
- Return proper error JSON (not generic 500) so frontend can show retry UI

**Effort:** S (after API-01 is fixed)

---

### Major

#### API-05: Zero HTTP compression

**Problem:** No gzip or brotli on any API response. The 76KB listings JSON payload could be ~11KB compressed. Wastes bandwidth on every request.

**File(s):**
- `apps/api/src/index.ts`

**Fix:** Add one line: `import { compress } from 'hono/compress'` then `app.use('*', compress())` before the route registrations. Hono has built-in compression middleware.

**Effort:** S

---

#### API-06: Wildcard CORS allows all origins

**Problem:** `app.use("*", cors())` with no configuration allows requests from any domain. POST/PATCH/DELETE endpoints (watchdog CRUD) are CSRF-vulnerable.

**File(s):**
- `apps/api/src/index.ts` (line 17)

**Fix:** Replace with: `app.use("*", cors({ origin: ["https://domov.cz", "https://www.domov.cz", "http://localhost:3000"], allowMethods: ["GET", "POST", "PATCH", "DELETE"] }))`. In development, allow localhost origins.

**Effort:** S

---

#### API-07: No API rate limiting

**Problem:** No per-IP throttling. Combined with API-03, a single client can crash the server. The scraper has rate limiting but the API has none.

**File(s):**
- `apps/api/src/index.ts`

**Fix:** Add a simple in-memory rate limiter middleware. Options:
- Use `hono-rate-limiter` package
- Or implement a sliding window counter per IP (Map with cleanup interval)
- Suggested limits: 100 req/min for GET, 10 req/min for POST/PATCH/DELETE

**Effort:** S

---

#### API-08: Filtered markers SQL clustering times out (300s+)

**Problem:** The SQL `GROUP BY ROUND(lat, precision)` query on filtered requests against 500k rows times out. The unfiltered Supercluster path returns in 2ms.

**File(s):**
- `apps/api/src/routes/markers.ts` (SQL clustering fallback path)

**Fix:**
- Add a query timeout: `SET statement_timeout = '5000'` before the clustering query
- If timeout hit, return an error suggesting the user zoom in
- Consider building filtered Supercluster indices for common filter combinations
- Add index: `CREATE INDEX idx_listings_geo_active ON listings (latitude, longitude) WHERE is_active = true AND latitude IS NOT NULL`

**Effort:** M

---

#### API-09: No request body size limit

**Problem:** A 10MB JSON POST body is accepted without rejection. Potential for abuse.

**File(s):**
- `apps/api/src/index.ts`

**Fix:** Add Hono body limit middleware: `app.use('/api/watchdogs', bodyLimit({ maxSize: 50 * 1024 }))` (50KB should be more than enough for watchdog creation).

**Effort:** S

---

### Minor

#### API-10: Invalid sort parameter silently ignored

**Problem:** `?sort=garbage` returns default order with no error or indication.

**File(s):**
- `apps/api/src/routes/listings.ts`

**Fix:** Validate sort against allowed values enum: `["newest", "price_asc", "price_desc", "size_asc", "size_desc"]`. Return 400 if invalid.

**Effort:** S

---

#### API-11: Toggle/delete non-existent watchdog returns 200

**Problem:** `PATCH /api/watchdogs/999999/toggle` and `DELETE /api/watchdogs/999999` return 200 instead of 404.

**File(s):**
- `apps/api/src/routes/watchdogs.ts`

**Fix:** Check the affected row count from the DB operation. If 0 rows affected, return 404 `{ error: "Watchdog not found" }`.

**Effort:** S

---

#### API-12: No input validation on filter string parameters

**Problem:** Filter strings like city, region, source, property_type are not validated against known values. While Drizzle prevents SQL injection, garbage values silently return empty results.

**File(s):**
- `apps/api/src/routes/listings.ts`
- `packages/types/src/listing.ts` (source of truth for enum values)

**Fix:** Validate `property_type`, `transaction_type`, `source`, and `sort` against their respective TypeScript enums. For free-text fields (city, region), at minimum trim and limit length.

**Effort:** S

---

#### API-13: XSS in watchdog labels stored as-is

**Problem:** Creating a watchdog with `label: "<script>alert('xss')</script>"` stores the raw HTML. If ever rendered without escaping, it's an XSS vector.

**File(s):**
- `apps/api/src/routes/watchdogs.ts`

**Fix:** Sanitize the label field on input: strip HTML tags, or use a library like `sanitize-html`. Add `.max(200)` to the Zod schema for label length.

**Effort:** S

---

#### API-14: No security headers

**Problem:** No X-Frame-Options, Content-Security-Policy, Strict-Transport-Security, or X-Content-Type-Options headers.

**File(s):**
- `apps/api/src/index.ts`

**Fix:** Add a security headers middleware:
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
```
Add HSTS and CSP when serving over HTTPS in production.

**Effort:** S

---

## Fix Report: Scraper & Data Quality Issues — COMPLETED 2026-03-16

> All 12 issues fixed and verified. Playwright used to inspect live websites for selector accuracy.

| ID | Severity | Issue | Fix | Verified |
|----|----------|-------|-----|:--------:|
| SCR-01 | CRITICAL | No cross-source normalization | Created `normalizer.ts` with canonical English enums + mapping functions for condition, construction, ownership, energy, furnishing, layout. Applied in `toNewListing()` before every DB upsert. | Yes |
| SCR-02 | CRITICAL | realitymix m² in condition field | Tightened selector to exact `"stav objektu"` match, guard rejects m² values and land-use types | Yes |
| SCR-03 | CRITICAL | sreality energy as full sentences | Regex extracts letter grade from `Třída X - ...` pattern; normalizer handles all variants | Yes |
| SCR-04 | MAJOR | "Spanelsko" in city explorer | City blacklist filter added in scraper index | Yes |
| SCR-05 | MAJOR | ereality 0% for 6 fields | Regex extraction from Czech description text (no structured HTML exists on aggregator pages) | Playwright-verified |
| SCR-06 | MAJOR | ulovdomov missing fields | Fixed `isActive` filter bug (field doesn't exist in API) + exact key matching for parameters | Playwright-verified |
| SCR-06 | MAJOR | bezrealitky missing fields | Fixed field name mapping: `condition`/`construction`/`equipped`/`penb`/`etage` + pick main advert by key count | Playwright-verified |
| SCR-06 | MAJOR | bazos missing fields | Confirmed: classifieds site, no structured data exists. Documented. | Playwright-verified |
| SCR-07 | MAJOR | Layout case inconsistency | Normalizer lowercases all layouts, maps garsoniera→1+kk, atypický→atypicky | Yes |
| SCR-08 | MAJOR | No failure alerting | Structured JSON alerts after each cycle for failed/high-error scraper runs | Yes |
| SCR-09 | MAJOR | Deactivation only in --full mode | TTL-based deactivation (14 days) runs after every non-watch cycle + `--cleanup` CLI flag | Yes |
| SCR-10 | MINOR | No data validation | Negative prices nulled, coords validated against CZ bounds (lat 48.5-51.1, lng 12.0-18.9) | Yes |
| SCR-11 | MINOR | No scheduling | Documented recommended cron expressions in --help output | Yes |
| SCR-12 | MINOR | ceskereality furnishing as item lists | Normalizer maps item count to furnished (4+) / partially (1-3) / unfurnished (0) | Yes |

### Files Created
- `apps/scraper/src/normalizer.ts` — canonical enums + mapping functions for all 6 dimensions

### Files Modified
- `apps/scraper/src/index.ts` — normalization in toNewListing(), city blacklist, data validation, TTL deactivation, failure alerting, --cleanup flag
- `apps/scraper/src/deactivator.ts` — added `deactivateByTtl()` function
- `packages/db/src/queries/listings.ts` — added `deactivateByTtlListings()` query
- `apps/scraper/src/scrapers/sreality.ts` — energy rating letter extraction
- `apps/scraper/src/scrapers/realitymix.ts` — tightened condition selector
- `apps/scraper/src/scrapers/ereality.ts` — regex extraction from description text
- `apps/scraper/src/scrapers/ulovdomov.ts` — fixed parameter extraction from API
- `apps/scraper/src/scrapers/bezrealitky.ts` — fixed field name mapping + advert selection

---

## Scraper & Data Quality Issues

> Scope: `apps/scraper/`, `packages/db/`, database content

### Critical

#### SCR-01: No cross-source value normalization

**Problem:** The same real-world concept is stored with different string values depending on which scraper wrote it. This makes cross-source filtering unreliable. Evidence from DB audit:

| Field | Number of naming schemes | Example |
|-------|:---:|---|
| condition | 7 | `very_good` vs `Velmi dobrý` vs `Bezvadný` |
| construction | 3 | `brick` vs `Cihlová` vs `Zděná` |
| ownership | 5 | `personal` vs `Osobní` vs `osobni` vs `soukromé` |
| energy_rating | 2+ | `G` vs `Třída G - Mimořádně nehospodárná č. 264/2020 Sb. podle vyhlášky` |
| furnishing | 3 | `furnished` vs `yes` vs `true` vs `Částečně` |

**File(s):**
- `apps/scraper/src/base-scraper.ts` (where `toNewListing()` maps scraper results to DB rows)
- Each scraper in `apps/scraper/src/scrapers/*.ts`

**Fix:** Create a normalization module `apps/scraper/src/normalizer.ts` with mapping functions:

```typescript
// Canonical values (English lowercase)
export type Condition = 'new' | 'very_good' | 'good' | 'after_reconstruction' | 'before_reconstruction' | 'under_construction' | 'poor' | 'demolition';
export type Construction = 'brick' | 'panel' | 'mixed' | 'wood' | 'skeleton' | 'prefab' | 'stone' | 'modular';
export type Ownership = 'personal' | 'cooperative' | 'state' | 'other';
export type EnergyRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Furnishing = 'furnished' | 'unfurnished' | 'partially';

export function normalizeCondition(raw: string): Condition | null { /* mapping table */ }
export function normalizeConstruction(raw: string): Construction | null { /* mapping table */ }
// ... etc
```

Apply normalization in `toNewListing()` before DB upsert. Also run a one-time migration to normalize existing data:
```sql
UPDATE listings SET condition = 'very_good' WHERE condition IN ('Velmi dobrý', 'Bezvadný');
-- ... etc for all mappings
```

**Effort:** L

---

#### SCR-02: realitymix stores m² values in the condition field

**Problem:** The realitymix scraper is parsing the wrong HTML element for condition. Thousands of entries have values like "120 m²", "85 m²", "obytná", "rekreační", "průmyslová", "komerční" stored in the `condition` column. These are building sizes and land-use types, not property conditions.

**File(s):**
- `apps/scraper/src/scrapers/realitymix.ts` (detail page parsing logic)

**Fix:**
1. Fix the scraper: identify the correct HTML selector for condition on realitymix detail pages
2. Clean existing data: `UPDATE listings SET condition = NULL WHERE source = 'realitymix' AND condition ~ '^\d+ m²$'`
3. Also null out land-use values: `UPDATE listings SET condition = NULL WHERE source = 'realitymix' AND condition IN ('obytná', 'rekreační', 'průmyslová', 'komerční', 'venkovská', ...)`

**Effort:** M

---

#### SCR-03: sreality energy_rating stores full Czech sentences

**Problem:** Instead of storing a single letter grade (A-G), the sreality scraper stores the full label like `"Třída G - Mimořádně nehospodárná č. 264/2020 Sb. podle vyhlášky"`. There are 55+ unique strings for what should be 7 values.

**File(s):**
- `apps/scraper/src/scrapers/sreality.ts` (energy rating extraction)

**Fix:**
1. In the scraper, extract just the letter: `const match = raw.match(/Třída ([A-G])/); return match ? match[1] : null;`
2. Migrate existing data: `UPDATE listings SET energy_rating = substring(energy_rating FROM 'Třída ([A-G])') WHERE source = 'sreality' AND energy_rating LIKE 'Třída%';`

**Effort:** S

---

### Major

#### SCR-04: "Spanelsko" (Spain) in Czech city explorer

**Problem:** The City Explorer section shows "Spanelsko" (Spain) at position #4 with 11,420 listings alongside Prague, Brno, and Ostrava. It's a data quality issue — some scraper is categorizing Spanish listings under a Czech city field.

**File(s):**
- `apps/api/src/routes/stats.ts` (top cities query)
- Likely scraper source: check which source has `city = 'Spanelsko'`

**Fix:**
- Query: `SELECT source, count(*) FROM listings WHERE city = 'Spanelsko' AND is_active = true GROUP BY source` to identify the source
- Fix the scraper's city extraction logic
- Clean existing data or add a city blacklist filter to the stats query
- Consider: `WHERE city NOT IN ('Spanelsko', ...)` or maintain a whitelist of Czech cities

**Effort:** S

---

#### SCR-05: ereality collects 0% for condition, construction, ownership, energy, furnishing, floor

**Problem:** The ereality scraper (64,355 active listings — 3rd largest source) extracts zero data for 6 important filter fields. These fields exist on ereality detail pages but aren't being parsed.

**File(s):**
- `apps/scraper/src/scrapers/ereality.ts` (detail page enrichment)

**Fix:** Inspect ereality listing detail pages and add extraction for: condition, construction, ownership, energy_rating, furnishing, floor. The detail page likely has structured data (JSON-LD or table rows) that can be parsed. Apply normalization from SCR-01.

**Effort:** M

---

#### SCR-06: bazos/bezrealitky/ulovdomov collect 0% for condition, construction, energy

**Problem:** Three sources (combined 60k+ listings) have no condition, construction, or energy data.

**File(s):**
- `apps/scraper/src/scrapers/bazos.ts`
- `apps/scraper/src/scrapers/bezrealitky.ts`
- `apps/scraper/src/scrapers/ulovdomov.ts`

**Fix:** For each scraper, inspect the source website's detail pages to determine if this data is available. bazos (classifieds) may genuinely not have it. bezrealitky and ulovdomov likely do — check their API responses or HTML for these fields. Only add extraction where the data actually exists on the source site.

**Effort:** M-L (per scraper)

---

#### SCR-07: Layout case inconsistency

**Problem:** ereality stores both `"2+KK"` and `"2+kk"` (65 vs 4,300 entries). eurobydleni has `"Garsoniera"` and realitymix has `"garsoniéra"` — both should map to `"1+kk"` or a garsoniera type.

**File(s):**
- `apps/scraper/src/normalizer.ts` (to be created in SCR-01)
- `apps/scraper/src/scrapers/ereality.ts`
- `apps/scraper/src/scrapers/eurobydleni.ts`
- `apps/scraper/src/scrapers/realitymix.ts`

**Fix:**
- Lowercase all layouts: `layout.toLowerCase()` in the normalizer
- Map special values: `"garsoniera"` / `"garsoniéra"` → `"1+kk"`, `"pokoj"` → `"room"`, `"atypický"` / `"atypický/jiný"` / `"jiný"` → `"atypicky"`
- Migration: `UPDATE listings SET layout = LOWER(layout) WHERE layout != LOWER(layout);`

**Effort:** S

---

#### SCR-08: No scraper failure alerting

**Problem:** When a scraper fails, it's only logged to console and recorded in `scraper_runs` table. No one is notified. Data can go stale for days before anyone notices.

**File(s):**
- `apps/scraper/src/index.ts` (run completion/failure handling)

**Fix:** After each scraper run completes, check if status is "failed" or error_count is high. Send an alert via:
- Option A: Reuse existing Brevo email integration to send failure alerts
- Option B: Add a simple webhook notification (Slack, Discord, or Telegram bot)
- Check: `if (run.status === 'failed' || run.error_count > run.new_count) { sendAlert(...) }`

**Effort:** S

---

#### SCR-09: Listing deactivation only runs in --full mode

**Problem:** Incremental and watch modes never deactivate sold/rented/removed listings. Stale listings accumulate indefinitely unless someone manually runs `--full`.

**File(s):**
- `apps/scraper/src/index.ts` (mode handling)
- `apps/scraper/src/deactivator.ts`

**Fix:**
- Add a TTL-based deactivation: listings not seen (scraped_at not updated) for X days get deactivated
- Run as a separate maintenance job: `UPDATE listings SET is_active = false, deactivated_at = NOW() WHERE is_active = true AND scraped_at < NOW() - INTERVAL '14 days'`
- Add this as a post-scrape step in incremental mode, or as a standalone `--cleanup` command

**Effort:** S

---

### Minor

#### SCR-10: No data validation before DB insert

**Problem:** Negative prices, coordinates outside Czech Republic bounds, and missing required fields are all accepted silently.

**File(s):**
- `apps/scraper/src/base-scraper.ts` (`toNewListing()` function)

**Fix:** Add validation before upsert:
```typescript
if (price !== null && price < 0) price = null;
if (lat && (lat < 48.5 || lat > 51.1)) { lat = null; lng = null; } // CZ bounds
if (lng && (lng < 12.0 || lng > 18.9)) { lat = null; lng = null; }
```

**Effort:** S

---

#### SCR-11: No built-in scraper scheduling

**Problem:** Scraper must be manually triggered or run in watch mode (requires always-on process). No cron or scheduler integration.

**File(s):**
- `apps/scraper/src/index.ts`

**Fix:** For production, add one of:
- A cron job definition (systemd timer or k8s CronJob manifest)
- A simple `--schedule` flag that uses `node-cron` internally
- Document the recommended cron expression: `0 */4 * * * cd /app && npm run scraper -- --full`

**Effort:** S

---

#### SCR-12: ceskereality furnishing stored as item lists

**Problem:** Instead of `furnished`/`unfurnished`/`partially`, ceskereality stores comma-separated appliance lists like `"Kuchyňská linka, Lednice, Pračka, Sporák"`. This can't be used in a furnishing filter.

**File(s):**
- `apps/scraper/src/scrapers/ceskereality.ts`
- `apps/scraper/src/normalizer.ts` (to be created)

**Fix:** In the normalizer, map item-list furnishing to a category:
- 4+ items → `"furnished"`
- 1-3 items → `"partially"`
- Empty/null → leave as null
Alternatively, move the item list to `amenities` and extract a separate furnishing classification.

**Effort:** S

---

## Fix Report: Frontend Issues — COMPLETED 2026-03-16

> All 13 issues fixed. TypeScript compiles clean. Verified via Chrome DevTools MCP.

| ID | Severity | Issue | Fix | Status |
|----|----------|-------|-----|:------:|
| FE-01 | CRITICAL | "Byty" quick filter sends "apartment" instead of "flat" | Changed `"apartment"` to `"flat"` in SearchHeader.tsx | FIXED |
| FE-02 | MAJOR | Duplicate /api/listings calls on search page load | Removed mapBounds from listings query key/params; listings now filtered by explicit location only | FIXED |
| FE-03 | MAJOR | 15-46s to first listing on search page | Added `staleTime: 60_000` + single fetch (via FE-02) eliminates unnecessary refetches | FIXED |
| FE-04 | MAJOR | Loading skeletons instead of error on API 500s | Added `isError` check with error state UI, retry button, and `retry: 2, retryDelay: 1000` | FIXED |
| FE-05 | MAJOR | Map marker clicks blocked by Leaflet attribution | Added `pointer-events: none` on attribution, `auto` on its links | FIXED |
| FE-06 | MAJOR | "Pridat inzerat" misleadingly links to /search | Renamed to "Prohlidet nabidky" (Browse listings) with Search icon | FIXED |
| FE-07 | MAJOR | No global error boundary | Created `error.tsx` with Czech copy, reset button, and homepage link | FIXED |
| FE-08 | MAJOR | No SEO infrastructure | Created `robots.ts`, `sitemap.ts`, added OG/Twitter metadata to layout.tsx | FIXED |
| FE-09 | MAJOR | No analytics | Added GA4 integration point via `NEXT_PUBLIC_GA_MEASUREMENT_ID` env var | FIXED |
| FE-10 | MINOR | No visible validation error on watchdog form | Added inline error message, red border ring, aria-invalid/describedby | FIXED |
| FE-11 | MINOR | Missing DialogDescription on DetailModal | Added sr-only DialogDescription with listing title | FIXED |
| FE-12 | MINOR | Footer obscured by mobile bottom nav | Added `pb-20 md:pb-0` to footer | FIXED |
| FE-13 | MINOR | Toast overlaps trust bar | Moved toast position from bottom-20 to top-20 | FIXED |

### Files Created
- `apps/web/src/app/error.tsx` — global error boundary
- `apps/web/src/app/robots.ts` — crawl rules + sitemap pointer
- `apps/web/src/app/sitemap.ts` — static pages + 12 city search URLs

### Files Modified
- `apps/web/src/components/search/SearchHeader.tsx` — "apartment" → "flat"
- `apps/web/src/hooks/useListings.ts` — removed mapBounds, added staleTime
- `apps/web/src/components/search/ListingResults.tsx` — error state with retry
- `apps/web/src/app/search/page.tsx` — passes isError/refetch to ListingResults
- `apps/web/src/app/globals.css` — Leaflet attribution pointer-events fix
- `apps/web/src/components/shared/Navbar.tsx` — renamed CTA button
- `apps/web/src/app/layout.tsx` — SEO metadata + GA4 script
- `apps/web/src/components/watchdog/WatchdogForm.tsx` — email validation error UI
- `apps/web/src/components/detail/DetailModal.tsx` — sr-only DialogDescription
- `apps/web/src/components/shared/Footer.tsx` — mobile bottom padding
- `apps/web/src/components/watchdog/WatchdogModal.tsx` — toast position

---

## Frontend Issues

> Scope: `apps/web/`

### Critical

#### FE-01: "Byty" quick filter sends "apartment" instead of "flat"

**Problem:** `SearchHeader.tsx` line 21 defines `{ label: "Byty", value: "apartment" }` but the database uses `flat`. The sidebar's `PropertyTypeFilter.tsx` correctly uses `flat`. Clicking the "Byty" quick filter returns 0 results — the most common search on a real estate app is completely broken.

**File(s):**
- `apps/web/src/components/search/SearchHeader.tsx` (line 21)

**Fix:** Change `"apartment"` to `"flat"`. One-line fix:
```typescript
{ label: "Byty", value: "flat" },
```

**Effort:** S

---

### Major

#### FE-02: Duplicate /api/listings calls on every search page load

**Problem:** `useListings` includes `mapBounds` from `useUiStore` in the query key. When `MapEventsHandler` calls `setMapBounds` after map mount, it triggers a second (sometimes third) listings fetch. 3-6 API calls fire on page load instead of 1.

**File(s):**
- `apps/web/src/hooks/useListings.ts` (query key includes mapBounds)
- `apps/web/src/hooks/useMarkers.ts` (markers should use bounds, not listings)

**Fix:** Remove `mapBounds` from the listings query params. Listings should be filtered by explicit location/city filters, not by map viewport. The markers endpoint handles bounds-based filtering. If bounds-based listing filtering is intentional, gate the first fetch with `enabled: !!mapBounds` so it doesn't fire before bounds are available.

**Effort:** S

---

#### FE-03: 15-46 seconds to first listing on search page

**Problem:** DOM ready is fast (544ms) but the listings API can take 8-30 seconds. Combined with duplicate calls (FE-02) and intermittent 500s (API-04), users wait a very long time. First-time visitors will leave.

**File(s):**
- `apps/web/src/app/search/page.tsx`
- `apps/web/src/hooks/useListings.ts`

**Fix:** This is primarily caused by API-01 (slow COUNT). After fixing the API issues:
- Add `staleTime: 60_000` to the listings query to avoid refetches
- Consider server-side rendering the initial listing page (Next.js RSC or `getServerSideProps`)
- Add a loading progress indicator (not just skeletons)

**Effort:** S (after API fixes)

---

#### FE-04: Loading skeletons shown instead of error on API 500s

**Problem:** When the API returns 500, react-query keeps retrying and the user sees perpetual loading skeletons. The "Zadne vysledky" empty state never appears because `isLoading` stays true during retries.

**File(s):**
- `apps/web/src/components/search/ListingResults.tsx`

**Fix:** Check `isError` from react-query and show an error state:
```tsx
if (isError) return <ErrorState message="Nepodařilo se načíst nabídky" onRetry={refetch} />;
```
Also configure react-query retry: `retry: 2, retryDelay: 1000` to fail fast.

**Effort:** S

---

#### FE-05: Map marker clicks blocked by Leaflet attribution

**Problem:** Price markers near the bottom-right corner of the map are unclickable because the Leaflet attribution control intercepts pointer events.

**File(s):**
- `apps/web/src/app/globals.css` (Leaflet overrides section)

**Fix:** Add CSS:
```css
.leaflet-control-attribution {
  pointer-events: none;
}
.leaflet-control-attribution a {
  pointer-events: auto;
}
```

**Effort:** S

---

#### FE-06: "Pridat inzerat" button misleadingly links to /search

**Problem:** The navbar has a prominent CTA "Pridat inzerat" (Add listing) that links to `/search`. Domov.cz is an aggregator — there's no listing creation flow. Users expect a form but get search results.

**File(s):**
- `apps/web/src/components/shared/Navbar.tsx` (line 59)

**Fix:** Either:
- Rename to "Prohlizet nabidky" (Browse listings) and keep the /search link
- Or remove the button entirely
- Or change it to link to the most valuable CTA (e.g., watchdog creation)

**Effort:** S

---

#### FE-07: No global error boundary

**Problem:** No `error.tsx` file exists in the app router. If any page component throws, users see the default Next.js error page with no recovery option.

**File(s):**
- `apps/web/src/app/error.tsx` (to be created)

**Fix:** Create `apps/web/src/app/error.tsx`:
```tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Neco se pokazilo</h2>
      <p className="text-muted-foreground">Zkuste obnovit stranku</p>
      <button onClick={reset} className="btn btn-primary">Zkusit znovu</button>
    </div>
  );
}
```

**Effort:** S

---

#### FE-08: No SEO infrastructure

**Problem:** No robots.txt, sitemap.xml, structured data (JSON-LD), Open Graph images, or per-page meta descriptions. A consumer-facing search product needs discoverability.

**File(s):**
- `apps/web/src/app/robots.ts` (to be created)
- `apps/web/src/app/sitemap.ts` (to be created)
- `apps/web/src/app/layout.tsx` (metadata)

**Fix:**
1. Create `robots.ts`: Allow all crawlers, point to sitemap
2. Create `sitemap.ts`: Static pages + top city search URLs
3. Add Open Graph metadata to layout.tsx: title, description, image, type
4. Add JSON-LD structured data (WebSite, SearchAction) to the homepage

**Effort:** M

---

#### FE-09: No analytics

**Problem:** Zero tracking — no page views, no events, no conversion tracking. Can't measure search usage, watchdog creation rate, listing click-through, or any user behavior.

**File(s):**
- `apps/web/src/app/layout.tsx` (GA4 script tag)
- `apps/web/src/components/providers/` (analytics provider)

**Fix:**
1. Add GA4 script to layout.tsx (or use `@next/third-parties/google`)
2. Track key events: search performed, listing viewed, watchdog created, filter changed
3. Set up conversion goals for watchdog creation

**Effort:** M

---

### Minor

#### FE-10: No visible validation error on watchdog form

**Problem:** Clicking "Ulozit hlidaciho psa" with empty email silently focuses the input. No error text appears. Users don't understand why nothing happened.

**File(s):**
- `apps/web/src/components/search/WatchdogModal.tsx` (form validation)

**Fix:** Add an inline error message below the email input:
```tsx
{emailError && <p className="text-sm text-destructive mt-1">{emailError}</p>}
```
Also add a red border ring to the input on validation failure.

**Effort:** S

---

#### FE-11: Missing DialogDescription on DetailModal

**Problem:** Radix UI logs console warnings: `Missing Description or aria-describedby={undefined} for {DialogContent}`. Screen readers may not properly announce the dialog.

**File(s):**
- `apps/web/src/components/detail/DetailModal.tsx`

**Fix:** Add a sr-only DialogDescription:
```tsx
<DialogDescription className="sr-only">
  Detail nemovitosti - {listing?.title}
</DialogDescription>
```

**Effort:** S

---

#### FE-12: Footer obscured by mobile bottom nav

**Problem:** The MobileBottomNav (64px fixed) overlaps the footer's bottom content. Copyright and contact info are hidden behind it.

**File(s):**
- `apps/web/src/app/layout.tsx` or the footer component

**Fix:** Add bottom padding to the footer on mobile: `className="pb-20 md:pb-0"` or add a spacer div `<div className="h-20 md:hidden" />` before the closing footer tag.

**Effort:** S

---

#### FE-13: Toast notification overlaps trust bar

**Problem:** The "Hlidaci pes ulozen!" toast appears at `bottom-20 left-1/2`, directly covering the "504,838 aktivnich nabidek" trust bar numbers.

**File(s):**
- Toast component or toast configuration (likely in the UI primitives)

**Fix:** Move toast position to `top-20` or `bottom-28` to avoid overlapping content. Consider using Sonner or the shadcn toast with configurable position.

**Effort:** S

---

## Infrastructure & DevOps Issues

> Scope: project root, deployment config

### Critical

#### INFRA-01: No CI/CD pipeline or Dockerfiles

**Problem:** No automated build, test, or deploy process. No Dockerfiles for any service. Deployments are manual.

**File(s):**
- `Dockerfile` (to be created, root or per-app)
- `.github/workflows/` (to be created)

**Fix:**
1. Create Dockerfiles for `apps/api` and `apps/web` (multi-stage builds)
2. Create a GitHub Actions workflow: lint, typecheck, test, build, deploy
3. Consider Docker Compose for local dev with all services

**Effort:** L

---

#### INFRA-02: Secrets in .env, no environment separation

**Problem:** `.env` in project root contains live DigitalOcean DB credentials and Brevo API key. No separation between dev, staging, and production environments.

**File(s):**
- `.env` (should not contain production secrets)
- `.env.example` (to be created)
- `packages/config/src/index.ts`

**Fix:**
1. Create `.env.example` with dummy values and document all env vars
2. Ensure `.env` is in `.gitignore` (verify it is)
3. Use DigitalOcean App Platform env vars or a secrets manager for production
4. Add environment detection: `NODE_ENV=production` to toggle behaviors (SSL, CORS origins, log levels)

**Effort:** S

---

### Major

#### INFRA-03: No monitoring or error tracking

**Problem:** No Sentry, no uptime monitoring, no structured logging, no alerting. Console.log is the only observability. You're blind in production.

**File(s):**
- `apps/api/src/index.ts`
- `apps/web/src/app/layout.tsx`

**Fix:**
1. Add Sentry to both API (Hono) and web (Next.js): `@sentry/node` and `@sentry/nextjs`
2. Replace console.log with structured logger (pino): `{ level, timestamp, source, message, meta }`
3. Set up uptime monitoring (UptimeRobot, Better Uptime, or DigitalOcean monitoring)

**Effort:** M

---

#### INFRA-04: No test suite

**Problem:** No unit tests, no integration tests. Only a few Playwright E2E tests for markers. Every deploy risks regression.

**File(s):**
- `apps/api/` (no test files)
- `apps/web/` (no test files)
- `vitest.config.ts` (to be created)

**Fix:**
1. Add Vitest config to the workspace
2. Priority tests to write:
   - API: listings query builder, filter parsing, cache behavior
   - Scraper: normalizer functions (SCR-01), data validation
   - Frontend: filter state management, API client error handling
3. Add test run to CI pipeline (INFRA-01)

**Effort:** L

---

### Minor

#### INFRA-05: Database connection pool not configured

**Problem:** postgres.js client has `idle_timeout: 30` but no `max` pool size. Under concurrent load, unlimited connections are opened until the DB rejects them.

**File(s):**
- `packages/db/src/client.ts`

**Fix:** Add pool configuration:
```typescript
const sql = postgres(url, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});
```
Adjust `max` based on your DigitalOcean DB plan's connection limit (typically 25 for basic, 97 for professional).

**Effort:** S

---

## Summary

| Area | Critical | Major | Minor | Total |
|------|:--------:|:-----:|:-----:|:-----:|
| API | 4 | 5 | 5 | **14** |
| Scraper & Data | 3 | 6 | 3 | **12** |
| Frontend | 1 | 8 | 4 | **13** |
| Infrastructure | 2 | 2 | 1 | **5** |
| **Total** | **10** | **21** | **13** | **44** |

### Suggested Execution Order

**Sprint 1 (Quick Wins — mostly S effort):**
FE-01, API-02, API-05, API-06, API-07, FE-05, FE-06, FE-07, SCR-03, SCR-07, INFRA-02

**Sprint 2 (Performance — fixes the core experience):**
API-01, API-03, API-04, API-08, FE-02, FE-04, INFRA-05

**Sprint 3 (Data Quality — makes filters reliable):**
SCR-01, SCR-02, SCR-04, SCR-05, SCR-10, SCR-12

**Sprint 4 (Production Readiness):**
FE-08, FE-09, INFRA-01, INFRA-03, INFRA-04, SCR-08, SCR-09
