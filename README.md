# Flat Finder CZ (Domov.cz)

Czech property listing aggregator — collects rentals and sales from **10 major Czech real estate portals** into a single dashboard with interactive map, filters, and watchdog email alerts.

## Features

- **400k+ real listings** from 10 Czech real estate portals
- **Interactive map** with Supercluster-based clustering, geocoded location search, and drill-down zoom
- **Sreality-style homepage** with property type tabs, transaction pills, and location search
- **Comprehensive search** (`/search`) with 14 filter dimensions — property type, disposition, location, price, area, condition, ownership, furnishing, building type, amenities, accessibility, energy class; URL-synced filters, paginated results, sidebar refinement
- **Watchdog alerts** (Hlídací pes) — save filter criteria + email, get notified when new matching listings appear
- **Listing deactivation** — listings removed from source sites are automatically marked inactive
- **Dark mode** support
- **Mobile responsive** layout

## Data Sources

| Source | Categories | Est. Listings |
|--------|-----------|---------------|
| **Sreality.cz** | Flats, houses, land, commercial, garages | ~92,000 |
| **Bezrealitky.cz** | Flats, houses, land | ~6,000 |
| **UlovDomov.cz** | Flats, houses | ~5,800 |
| **Idnes Reality** | Flats, houses, land, commercial, garages | ~15,000 |
| **Bazos.cz** | Flats, houses, land | ~10,000 |
| **CeskeReality.cz** | Flats, houses, land, commercial, cottages | ~8,000 |
| **Realitymix.cz** | Flats, houses, land, commercial | ~5,000 |
| **eReality.cz** | Flats, houses, land | ~3,000 |
| **Eurobydleni.cz** | Flats, houses | ~2,000 |
| **Realingo.cz** | Flats, houses, land | ~1,500 |

## Tech Stack

- **Frontend**: Next.js 15 + React 19, TanStack Query, Zustand, Framer Motion, shadcn/ui
- **Backend**: Hono (Node.js HTTP framework)
- **Scraper**: TypeScript, async generators, parallel source execution, live terminal dashboard
- **Notifier**: Brevo (email API) for watchdog alerts
- **Database**: PostgreSQL + Drizzle ORM
- **Maps**: Leaflet + CARTO Voyager tiles + Supercluster (server-side spatial index)
- **Geocoding**: OpenStreetMap Nominatim (location search → map zoom)
- **Monorepo**: npm workspaces

## Project Structure

```
flat-finder-cz/
├── apps/
│   ├── api/                  # Hono REST API server (port 4000)
│   ├── web/                  # Next.js frontend (port 3000)
│   ├── scraper/              # Multi-source scraper with 3 run modes
│   └── notifier/             # Watchdog email notification worker
├── packages/
│   ├── config/               # Zod-validated env config
│   ├── db/                   # Drizzle ORM schema, queries, migrations
│   └── types/                # Shared TypeScript types
├── certs/                    # SSL CA certificate for managed DB (gitignored)
├── .env                      # Environment variables (gitignored)
└── package.json              # Workspace root
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

Create a `.env` file in the project root:

```env
DB_USERNAME=your_user
DB_PASSWORD=your_password
DB_HOST=your_host
DB_PORT=25060
DB_DATABASE=your_database
DB_SSLMODE=require
```

If your database requires a CA certificate (e.g. DigitalOcean Managed Databases), place it at `certs/ca-certificate.crt`.

Push the schema to the database:

```bash
npm run db:push
```

### 3. Build packages

```bash
npm run build
```

### 4. Populate the database

Run the scraper to fetch real listings from all sources:

```bash
npm run scraper
```

See [Scraper](#scraper) for details on run modes.

### 5. Start the API server

```bash
npm run dev:api
```

The API starts on `http://localhost:4000`. On startup it:
- Begins a background refresh of the **listing_stats** table (pre-computed aggregate statistics)
- Builds a **Supercluster spatial index** over all listing coordinates (~1-2 min for 400K+ points), rebuilt every 15 minutes
- Pre-warms the listings cache

Stats and markers are served from materialized tables, so requests respond in <50ms even while background refreshes are running.

### 6. Start the frontend

```bash
npm run dev:web
```

The frontend starts on `http://localhost:3000`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | Paginated listings with filters |
| GET | `/api/listings/<id>` | Single listing detail |
| GET | `/api/markers` | Map markers with Supercluster clustering |
| GET | `/api/markers/expansion-zoom/<id>` | Get zoom level to split a cluster |
| GET | `/api/markers/preview/<id>` | Lightweight hover preview (title + thumbnail) |
| GET | `/api/stats` | Aggregate statistics (materialized, <50ms) |
| GET | `/api/health` | Health check |
| POST | `/api/watchdogs` | Create a watchdog |
| GET | `/api/watchdogs?email=...` | List watchdogs by email |
| PATCH | `/api/watchdogs/<id>/toggle` | Pause/resume watchdog |
| DELETE | `/api/watchdogs/<id>` | Delete watchdog |

### Filter Parameters

`transaction_type`, `property_type`, `city`, `region`, `source`, `layout`, `condition`, `construction`, `ownership`, `furnishing`, `energy_rating`, `price_min`, `price_max`, `size_min`, `size_max`, `amenities`, `location`, `sort`, `page`, `per_page`

## Performance Architecture

The API is designed for a managed PostgreSQL database with limited connections (~25) and 400K+ listings:

- **Materialized stats** — `listing_stats` table stores pre-computed aggregates (~31 rows), refreshed every 15 minutes in the background. Stats endpoint reads from this table in <50ms instead of running COUNT/GROUP BY on 400K rows.
- **Materialized marker clusters** — `marker_clusters` table stores pre-clustered map data at 4 zoom precisions, refreshed every 15 minutes. Unfiltered map requests read from this table in <5ms.
- **Filtered markers** — use index-friendly SQL (composite index on `is_active, property_type, transaction_type, lat, lng`) with in-memory post-filtering for price/size. Avoids expensive ILIKE and GROUP BY queries.
- **Connection pool** — capped at 5 connections. Background refreshes use dedicated connections via `createDb()` to avoid starving request handlers.
- **Graceful shutdown** — SIGTERM/SIGINT handlers abort in-flight pre-warm requests, stop background refreshes, close the DB pool, and force-exit after 2s.

## Scraper

The scraper fetches listings from 10 source sites with parallel source execution (each source gets its own DB connection):

- **Sreality**: REST API — flats, houses, land, commercial, garages (sale/rent/auction)
- **Bezrealitky**: GraphQL API — flats, houses, land (sale/rent)
- **UlovDomov**: REST API — flats, houses (sale/rent)
- **Idnes Reality**: AJAX pagination + detail enrichment (GPS, description, seller info)
- **Bazos.cz**: HTML scraping — flats, houses, land
- **CeskeReality.cz**: HTML + JSON-LD — flats, houses, land, commercial, cottages (sale/rent/auction)
- **Realitymix.cz**: HTML scraping — flats, houses, land, commercial
- **eReality.cz**: HTML scraping — flats, houses, land
- **Eurobydleni.cz**: HTML scraping — flats, houses
- **Realingo.cz**: HTML scraping — flats, houses, land

### Run Modes

**Incremental** (default) — stops fetching a category early when all listings on a page are already known.

```bash
npm run scraper
npm run scraper -- --source sreality              # single source
npm run scraper -- --source idnes,ceskereality    # multiple sources
npm run scraper -- --dry-run                      # no DB writes
```

**Full** (`--full`) — fetches all pages from all sources, then deactivates listings that were not seen. Skips detail re-enrichment for listings scraped within the last 24 hours.

```bash
npm run scraper -- --full
npm run scraper -- --source idnes,ceskereality,realingo --full
```

**Watcher** (`--watch`) — loops continuously, checking only the newest pages per category.

```bash
npm run scraper -- --watch                    # default 300s interval
npm run scraper -- --watch --interval 60      # 60s between cycles
```

### CLI Options

| Flag | Description |
|------|-------------|
| `--source <names>` | Comma-separated sources or `all` (default: `all`) |
| `--dry-run` | Collect listings but skip all DB writes |
| `--full` | Full scan + deactivate stale listings |
| `--watch` | Watcher mode: loop checking newest pages |
| `--interval <secs>` | Seconds between watcher cycles (default: 300) |
| `--no-dashboard` | Disable live terminal dashboard |
| `--cleanup` | Run TTL-based deactivation only (14 day threshold) |
| `--dedupe` | Cluster cross-source duplicates (geo + size + price + transaction_type matching) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SREALITY_RPS` | 25 | Sreality requests per second |
| `SREALITY_CONCURRENCY` | 50 | Sreality max concurrent requests |
| `BEZREALITKY_RPS` | 3 | Bezrealitky requests per second |
| `BEZREALITKY_CONCURRENCY` | 5 | Bezrealitky max concurrent requests |
| `ULOVDOMOV_RPS` | 8 | UlovDomov requests per second |
| `ULOVDOMOV_CONCURRENCY` | 10 | UlovDomov max concurrent requests |
| `IDNES_RPS` | 20 | Idnes requests per second |
| `IDNES_CONCURRENCY` | 15 | Idnes max concurrent requests |
| `IDNES_CATEGORY_PARALLELISM` | 3 | Categories to scrape in parallel |
| `IDNES_SKIP_ENRICHMENT_HOURS` | 24 | Skip detail re-fetch if scraped within N hours |
| `CESKEREALITY_RPS` | 3 | CeskeReality requests per second (hard 429 limit) |
| `CESKEREALITY_CONCURRENCY` | 3 | CeskeReality max concurrent requests |
| `CESKEREALITY_CATEGORY_PARALLELISM` | 2 | Categories to scrape in parallel |
| `WATCHER_INTERVAL_S` | 300 | Default watcher loop interval (seconds) |
| `WATCHER_MAX_PAGES` | 3 | Max pages per category in watch mode |
| `MAX_RETRIES` | 3 | HTTP retry attempts |
| `DETAIL_BATCH_SIZE` | 20 | Listings per detail-fetch batch |

### Recommended Cron Schedule

```bash
# Incremental scrape every 4 hours
0 */4 * * * cd /app && npm run scraper 2>&1 | tee -a /var/log/scraper.log

# Full scrape + deactivation once daily at 3 AM
0 3 * * * cd /app && npm run scraper -- --full 2>&1 | tee -a /var/log/scraper-full.log

# TTL cleanup daily at 5 AM (safety net)
0 5 * * * cd /app && npm run scraper -- --cleanup 2>&1 | tee -a /var/log/scraper-cleanup.log

# Cross-source dedup clustering daily at 6 AM
0 6 * * * cd /app && npm run scraper -- --dedupe 2>&1 | tee -a /var/log/scraper-dedupe.log
```

## Map Clustering

The map uses **Supercluster** (KD-tree spatial index) for zoom-aware hierarchical clustering:

- Builds an index over all ~400K listing coordinates on API startup
- Sub-millisecond viewport queries at any zoom level
- ~35 clusters at country zoom, scaling naturally as the user zooms in
- Cluster click drills down to the exact expansion zoom level
- Filtered queries use index-friendly SQL + in-memory Supercluster for small result sets
- Index rebuilds every 15 minutes to pick up new/deactivated listings

## Notifier

The notifier checks active watchdogs against new listings and sends email alerts via Brevo.

```bash
npm run notifier                              # single run
npm run notifier -- --loop --interval 300     # continuous loop
npm run notifier -- --dry-run                 # preview without sending
```

## Watchdog (Hlídací pes)

Users can save search criteria with their email. When the scraper finds new listings matching those criteria, the notifier sends an email. Watchdogs can be paused/resumed/deleted via the API.

## Deployment

Production runs on a single DigitalOcean droplet (`167.172.176.70`, 4 GB Premium AMD + 2 GB swap) at **bytomat.com**. Cloudflare proxies → Nginx (443, self-signed cert, Full SSL) → Next.js on `:3000`. PM2 manages three processes: `api` (port 4000, `--max-old-space-size=2048`), `web` (port 3000), `scraper` (watch mode). DigitalOcean Managed PostgreSQL (25-connection limit). No CI — deployment is manual SSH + git pull + build + PM2 restart.

The reference runbook lives in the Obsidian vault at `projects/personal/flat-finder-cz/droplet-deployment.md` (full session log, gotchas, infra decisions).

### Full deploy (any change — workspace packages, API, web)

```bash
ssh root@167.172.176.70 "
  cd /root/flat-finder-cz &&
  git branch --show-current &&        # confirm 'main' before pulling
  git pull --ff-only &&
  rm -rf apps/web/.next &&             # webpack cache can ship stale workspace bundles
  npm run build &&
  pm2 restart api web
"
```

### Fast deploy (web-only, no workspace package changes)

Build locally and rsync the bundle — avoids the slow build on the droplet:

```bash
rm -rf apps/web/.next
npm -w apps/web run build
rsync -az --delete apps/web/.next/ root@167.172.176.70:/root/flat-finder-cz/apps/web/.next/
ssh root@167.172.176.70 "pm2 restart web"
```

### Verify

```bash
ssh root@167.172.176.70 "pm2 list"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://bytomat.com/   # 307 → password gate is healthy
ssh root@167.172.176.70 "curl -s http://localhost:4000/api/health"   # {\"status\":\"ok\"}
```

### Gotchas

- `git branch --show-current` before pulling — droplet has been caught on a stale feature branch where `git pull` reports "Already up to date".
- Always `pm2 restart web` after `next build`. Without it, the server keeps serving HTML referencing old chunk hashes → `ChunkLoadError` on clients.
- `pm2 restart` does **not** pick up changes to `node_args` in `ecosystem.config.cjs`. Use `pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>` for those.
- `ecosystem.config.cjs` and `apps/web/.env` (symlink to root `.env`) live on the droplet only and are not in git.
- API holds a Supercluster index in memory (~430 MB at 355K points, doubles briefly during the 15-min DB rebuild). If you scale point counts up, watch for OOM in `pm2 logs api`.

## Must-haves before public launch

The watchdog ("Hlídač nemovitostí") backend ships in a v1 shape suitable for a private/closed beta. Before flipping email notifications on for the public, the following items MUST be in place — together they cover GDPR consent, anti-abuse hygiene, and inbox health:

- **Double opt-in / GDPR consent**: gate `last_notified_at` updates on a `confirmed_at` column in `watchdogs`. New rows start unconfirmed; first email is a confirmation link; ongoing alerts only flow once the user clicks through. Required for ČR/EU GDPR + Brevo's transactional ToS.
- **Self-service unsubscribe / pause / manage pages**: the notifier already emits signed `?token=` links to `/watchdog/manage` (HMAC-SHA256, see `apps/notifier/src/tokens.ts`). The landing page is currently a stub — wire up token verification, action handling (pause / resume / unsubscribe / delete), and a clean confirmation UI before going public.
- **Brevo bounce webhook**: handle `hard_bounce` / `spam` / `unsubscribed` events from Brevo by auto-deactivating the corresponding watchdog. Without this we keep emailing dead addresses and our sender reputation rots.
- **Dead-listing landing page**: when an email's "Zobrazit detail" CTA points at a `bytomat.com/listing/<id>` that has since gone inactive, render a graceful "tato nabídka už není aktivní + podobné nabídky" page instead of the current generic detail view. Improves user trust + reduces bounce-rate signal back to Brevo.

## License

MIT
