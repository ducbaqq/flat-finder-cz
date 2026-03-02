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

- **Frontend**: Vanilla JS, Leaflet.js, CSS custom properties
- **Backend**: Python 3 + Flask (lightweight API server)
- **Collector**: Python 3 (stdlib only — no pip dependencies)
- **Database**: SQLite
- **Maps**: Leaflet + CARTO Voyager tiles + MarkerCluster plugin

## Project Structure

```
flat-finder-cz/
├── frontend/               # Static frontend files
│   ├── index.html          # Main dashboard
│   ├── base.css            # CSS reset & base styles
│   ├── style.css           # Design tokens & theme
│   ├── app.css             # Component styles
│   └── app.js              # Application logic
├── backend/
│   ├── api.py              # Flask API server
│   ├── collector.py        # Production collector (Sreality, Bezrealitky, UlovDomov)
│   ├── COLLECTOR_README.md # Collector documentation
│   └── requirements.txt    # Flask dependencies
├── data/                   # SQLite database (gitignored)
├── .gitignore
└── README.md
```

## Quick Start

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Populate the database

Run the collector to fetch real listings from all 3 sources:

```bash
cd backend
DB_PATH=../data/flat_finder.db python collector.py
```

The first run fetches all available listings (~100k). Subsequent runs only fetch new/updated listings. Set up a cron job to run every 5 minutes:

```bash
*/5 * * * * DB_PATH=/path/to/data/flat_finder.db /usr/bin/python3 /path/to/backend/collector.py >> /var/log/collector.log 2>&1
```

### 3. Start the API server

```bash
cd backend
python api.py
```

The server starts on `http://localhost:4000`.

### 4. Open the frontend

Navigate to `http://localhost:4000` — Flask serves the frontend files automatically.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | Paginated listings with filters |
| GET | `/api/listings/<id>` | Single listing detail |
| GET | `/api/markers` | Map markers with clustering |
| GET | `/api/stats` | Aggregate statistics |
| GET | `/api/seed` | Database status check |
| POST | `/api/watchdogs` | Create a watchdog |
| GET | `/api/watchdogs?email=...` | List watchdogs by email |
| PATCH | `/api/watchdogs/<id>/toggle` | Pause/resume watchdog |
| DELETE | `/api/watchdogs/<id>` | Delete watchdog |

### Filter Parameters

`transaction_type`, `property_type`, `city`, `region`, `source`, `layout`, `condition`, `construction`, `ownership`, `furnishing`, `energy_rating`, `price_min`, `price_max`, `size_min`, `size_max`, `amenities`, `location`, `sort`, `page`, `per_page`

## Collector

The `backend/collector.py` fetches listings from all 3 source APIs:

- **Sreality**: REST API (`/api/cs/v2/estates`) — flats, houses, land, commercial, garages (sale/rent/auction)
- **Bezrealitky**: Next.js data routes with Apollo cache — flats, houses, land (sale/rent)
- **UlovDomov**: REST API (`/v1/offer/find`) — flats, houses (sale/rent)

Features:
- Deduplication by `external_id` — only inserts new listings
- Automatic deactivation of listings removed from source sites
- Rate limiting and retry logic
- Stdlib only (no pip dependencies for the collector)

See `backend/COLLECTOR_README.md` for detailed documentation.

## Watchdog (Hlídací pes)

Users can save search criteria with their email. When the collector finds new listings matching those criteria, an email notification is sent. Watchdogs are stored in SQLite and can be paused/resumed/deleted.

## License

MIT
