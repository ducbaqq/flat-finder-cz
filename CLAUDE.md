---
  Flat Finder CZ — Scraper Architecture Context

  What This Project Is

  A Czech real estate aggregator that scrapes multiple property listing websites, normalizes the
  data, stores it in PostgreSQL, and displays it on a map-based frontend. The monorepo lives at
  /Users/ducba/personal/flat-finder-cz/.

  How the Main Scraper Works (apps/scraper/)

  The main scraper has three modes: incremental (default), full scan, and watcher. All three
  follow a two-phase pattern:

  Phase 1 — Fast List Scan: The scraper fetches listing pages (either HTML snippets or API
  responses) that contain basic info about many listings at once: external ID, title, price,
  address, thumbnail. This is cheap and fast. Each page yields a batch of lightweight
  ScraperResult objects.

  Phase 2 — Detail Enrichment: Only for new listings (ones not already in our database), the
  scraper fetches individual detail pages to get richer data: GPS coordinates, full description,
  floor number, construction type, energy rating, seller contact info, all images, etc.

  Deactivation: In full-scan mode, after seeing all listings from a source, the scraper compares
  what it found against what's in the database. Any listing that exists in our DB but was NOT
  seen in the current scrape gets marked is_active = false with a deactivated_at timestamp. This
  means the property was sold, rented, or removed.

  The Two-Phase Pattern in Detail

  Every scraper extends BaseScraper (apps/scraper/src/base-scraper.ts) and implements:

  1. fetchPages(): AsyncGenerator<PageResult> — Yields pages of basic listings. Each PageResult
  has { category, page, totalPages, listings: ScraperResult[] }. The runner consumes these one
  page at a time.
  2. enrichListings(listings, opts) — Takes an array of basic ScraperResult objects and enriches
  them in-place by fetching individual detail pages. Only scrapers that have detail pages
  implement this (indicated by hasDetailPhase = true).

  The runner (apps/scraper/src/index.ts) orchestrates this:
  - Consumes pages from fetchPages()
  - For each page, checks which external_ids already exist in the DB using
  findExistingExternalIds()
  - Calls enrichListings() only on the NEW listings
  - Upserts everything (new + updated) to the DB
  - In incremental/watcher mode, if an entire page contains only known listings, it skips the
  rest of that category (early stop)

  The Data Model (ScraperResult)

  Every scraped listing must normalize to this interface (from packages/types/src/scraper.ts):

  external_id     — unique ID like "sreality_12345" or "idnes_abc123"
  source          — source name like "sreality", "bezrealitky", "idnes"
  property_type   — "flat" | "house" | "land" | "commercial" | "garage" | "cottage" | "other"
  transaction_type — "sale" | "rent" | "auction"
  title, description, price, currency, price_note
  address, city, district, region
  latitude, longitude (GPS)
  size_m2, layout (e.g. "2+kk", "3+1")
  floor, total_floors
  condition, construction, ownership, furnishing, energy_rating
  amenities, image_urls (JSON string of URL array), thumbnail_url
  source_url (link back to original listing)
  listed_at, scraped_at
  is_active, deactivated_at
  seller_name, seller_phone, seller_email, seller_company
  additional_params (JSON string for extra source-specific data)

  The database table (packages/db/src/schema/listings.ts) mirrors this exactly. The external_id
  column has a unique constraint — upserts use it to update existing rows or insert new ones.

  Infrastructure Available

  - HttpClient (apps/scraper/src/http-client.ts) — Rate-limited HTTP with exponential backoff
  retry. Supports get(), post(), getHtml().
  - RateLimiter — Token-bucket rate limiter (requests per second).
  - p-limit — Used for concurrency control on parallel fetches.
  - Config (packages/config/src/index.ts) — Environment variables for RPS, concurrency, retry
  settings per scraper.

  What New Scrapers Need

  A new scraper for site X needs to:

  1. Research the site — Find out if it has a JSON API, AJAX endpoints, or is HTML-only. Many
  Czech sites have hidden AJAX endpoints (add X-Requested-With: XMLHttpRequest header) that
  return lighter payloads than full pages.
  2. Implement fetchPages() — The fast scan. Iterate through all categories (property types ×
  transaction types), paginate through listings, yield PageResult batches. Extract the basic
  fields available from list pages.
  3. Implement enrichListings() — The detail fetch. For each listing, fetch its detail page/API
  and fill in the fields not available from the list view (GPS, description, floor, etc.). Mark
  hasDetailPhase = true.
  4. Normalize data — Map the site's property types, transaction types, layouts, conditions, etc.
   to our standard values.
  5. Handle deactivation — The runner handles this automatically. The scraper just needs to yield
   all visible listings so the runner can compare against the DB.

  Current New Scrapers (in scrapers-new/)

  There are 7 standalone scrapers being developed in
  /Users/ducba/personal/flat-finder-cz/scrapers-new/ for: reality.idnes.cz, reality.bazos.cz,
  ceskereality.cz, realingo.cz, ereality.cz, realitymix.cz, eurobydleni.cz. They currently use a
  simplified standalone BaseScraper with SQLite storage for independent testing. Once polished,
  they'll be converted to the main scraper's BaseScraper pattern with fetchPages() +
  enrichListings() and integrated into the main runner.

  ---