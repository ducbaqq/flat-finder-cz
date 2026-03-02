# Flat Finder CZ

Czech property listing aggregator — collects rentals and sales from **sreality.cz**, **bezrealitky.cz**, and **ulovdomov.cz** into a single dashboard with interactive map, filters, and watchdog email alerts.

## Features

- **100k+ real listings** from 3 major Czech real estate portals
- **Interactive map** with Leaflet.js + marker clustering (CARTO Voyager tiles)
- **Comprehensive filters** — transaction type, property type, location, price, size, layout, condition, construction, ownership, furnishing, energy rating, amenities, source
- **Bilingual UI** — Czech labels with English translations
- **Watchdog alerts** (Hlídací pes) — save filter criteria + email, get notified when new matching listings appear
- **Paginated listings** with detail modals, image galleries, and source links
- **Listing deactivation** — listings removed from source sites are automatically marked inactive
- **Dark mode** support
- **Mobile responsive** layout

## Data Sources

| Source | Categories | Listings |
|--------|-----------|----------|
| **Sreality.cz** | Flats, houses, land, commercial, garages | ~92,000 |
| **Bezrealitky.cz** | Flats, houses, land | ~6,000 |
| **UlovDomov.cz** | Flats, houses | ~5,800 |

## Tech Stack

- **Frontend**: Next.js 15 + React 19, TanStack Query, Zustand, Leaflet.js
- **Backend**: Hono (Node.js HTTP framework)
- **Scraper**: TypeScript, async generators, parallel source execution
- **Notifier**: Brevo (email API) for watchdog alerts
- **Database**: PostgreSQL + Drizzle ORM
- **Maps**: Leaflet + CARTO Voyager tiles + MarkerCluster plugin
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

Run the scraper to fetch real listings from all 3 sources:

```bash
npm run scraper
```

See [Scraper](#scraper) for details on run modes.

### 5. Start the API server

```bash
npm run dev:api
```

The API starts on `http://localhost:4000`.

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
| GET | `/api/markers` | Map markers with clustering |
| GET | `/api/stats` | Aggregate statistics |
| GET | `/api/health` | Health check |
| POST | `/api/watchdogs` | Create a watchdog |
| GET | `/api/watchdogs?email=...` | List watchdogs by email |
| PATCH | `/api/watchdogs/<id>/toggle` | Pause/resume watchdog |
| DELETE | `/api/watchdogs/<id>` | Delete watchdog |

### Filter Parameters

`transaction_type`, `property_type`, `city`, `region`, `source`, `layout`, `condition`, `construction`, `ownership`, `furnishing`, `energy_rating`, `price_min`, `price_max`, `size_min`, `size_max`, `amenities`, `location`, `sort`, `page`, `per_page`

## Scraper

The scraper fetches listings from all 3 source APIs with parallel source execution (each source gets its own DB connection):

- **Sreality**: REST API (`/api/cs/v2/estates`) — flats, houses, land, commercial, garages (sale/rent/auction)
- **Bezrealitky**: Next.js data routes with Apollo cache — flats, houses, land (sale/rent)
- **UlovDomov**: REST API (`/v1/offer/find`) — flats, houses (sale/rent)

### Run Modes

**Incremental** (default) — stops fetching a category early when all listings on a page are already known. No deactivation since it doesn't see everything.

```bash
npm run scraper
npm run scraper -- --source sreality    # single source
npm run scraper -- --dry-run            # no DB writes
```

**Full** (`--full`) — fetches all pages from all sources, then deactivates listings that were not seen (i.e. removed from the source site).

```bash
npm run scraper -- --full
```

**Watcher** (`--watch`) — loops continuously, checking only the newest pages per category. New listings are enriched with detail data and upserted inline. Exits cleanly on SIGINT/SIGTERM.

```bash
npm run scraper -- --watch                    # default 300s interval
npm run scraper -- --watch --interval 60      # 60s between cycles
```

### Architecture

Scrapers are async generators that yield one page at a time. The runner controls when to stop (incremental early-stop), when to enrich (inline vs batch), and when to deactivate.

```
Runner (index.ts)                    Scraper (sreality.ts etc.)
─────────────────                    ──────────────────────────
                                     async *fetchPages()
for await (page of fetchPages())  ←── yield { category, page, listings }
  check if all known (early-stop)     yield { category, page, listings }
  watcher: enrich inline + upsert    yield ...
full: enrichListings(all), upsert    (generator done)
deactivate if --full
```

### CLI Options

| Flag | Description |
|------|-------------|
| `--source <name>` | `sreality`, `bezrealitky`, `ulovdomov`, or `all` (default: `all`) |
| `--dry-run` | Collect listings but skip all DB writes |
| `--full` | Full scan + deactivate stale listings |
| `--watch` | Watcher mode: loop checking newest pages |
| `--interval <secs>` | Seconds between watcher cycles (default: 300) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SREALITY_RPS` | 5 | Sreality requests per second |
| `SREALITY_CONCURRENCY` | 10 | Sreality max concurrent requests |
| `BEZREALITKY_RPS` | 3 | Bezrealitky requests per second |
| `BEZREALITKY_CONCURRENCY` | 5 | Bezrealitky max concurrent requests |
| `ULOVDOMOV_RPS` | 5 | UlovDomov requests per second |
| `ULOVDOMOV_CONCURRENCY` | 10 | UlovDomov max concurrent requests |
| `WATCHER_INTERVAL_S` | 300 | Default watcher loop interval (seconds) |
| `WATCHER_MAX_PAGES` | 3 | Max pages per category in watch mode |
| `WATCHER_DETAIL_CONCURRENCY` | 8 | Concurrent detail fetches in watch mode |
| `MAX_RETRIES` | 3 | HTTP retry attempts |
| `DETAIL_BATCH_SIZE` | 20 | Listings per detail-fetch batch |

## Notifier

The notifier checks active watchdogs against new listings and sends email alerts via Brevo.

```bash
npm run notifier                              # single run
npm run notifier -- --loop --interval 300     # continuous loop
npm run notifier -- --dry-run                 # preview without sending
```

## Watchdog (Hlídací pes)

Users can save search criteria with their email. When the scraper finds new listings matching those criteria, the notifier sends an email. Watchdogs can be paused/resumed/deleted via the API.

## License

MIT
