# Flat Finder CZ 🏠

Czech property listing aggregator — collects rentals and sales from **sreality.cz**, **bezrealitky.cz**, and **ulovdomov.cz** into a single dashboard with interactive map, filters, and watchdog email alerts.

## Features

- **Unified search** across 3 major Czech real estate portals
- **Interactive map** with Leaflet.js + marker clustering (CARTO Voyager tiles)
- **Comprehensive filters** — transaction type, property type, location, price, size, layout, condition, construction, ownership, furnishing, energy rating, amenities, source
- **Bilingual UI** — Czech labels with English translations
- **Watchdog alerts** (Hlídací pes) — save filter criteria + email, get notified when new matching listings appear
- **Paginated listings** with detail modals, image galleries, and source links
- **Dark mode** support
- **Mobile responsive** layout

## Tech Stack

- **Frontend**: Vanilla JS, Leaflet.js, CSS custom properties
- **Backend**: Python 3 + Flask (lightweight API server)
- **Database**: SQLite
- **Maps**: Leaflet + CARTO Voyager tiles + MarkerCluster plugin

## Project Structure

```
flat-finder-cz/
├── frontend/          # Static frontend files
│   ├── index.html     # Main dashboard
│   ├── base.css       # CSS reset & base styles
│   ├── style.css      # Design tokens & theme
│   ├── app.css        # Component styles
│   └── app.js         # Application logic
├── backend/
│   ├── api.py         # Flask API server
│   ├── collector.py   # Listing collector (scaffold)
│   └── requirements.txt
├── data/              # SQLite database (gitignored)
├── .gitignore
└── README.md
```

## Quick Start

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Start the API server

```bash
python api.py
```

The server starts on `http://localhost:5000`. On first run, it seeds 200 demo listings.

### 3. Open the frontend

Open `frontend/index.html` in your browser, or serve it:

```bash
cd frontend
python -m http.server 8080
```

Visit `http://localhost:8080`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | Paginated listings with filters |
| GET | `/api/listings/<id>` | Single listing detail |
| GET | `/api/markers` | Map markers with clustering |
| GET | `/api/stats` | Aggregate statistics |
| GET | `/api/seed` | Seed database with demo data |
| POST | `/api/watchdogs` | Create a watchdog |
| GET | `/api/watchdogs?email=...` | List watchdogs by email |
| PATCH | `/api/watchdogs/<id>/toggle` | Pause/resume watchdog |
| DELETE | `/api/watchdogs/<id>` | Delete watchdog |

### Filter Parameters

`transaction_type`, `property_type`, `city`, `region`, `source`, `layout`, `condition`, `construction`, `ownership`, `furnishing`, `energy_rating`, `price_min`, `price_max`, `size_min`, `size_max`, `amenities`, `location`, `sort`, `page`, `per_page`

## Watchdog (Hlídací pes)

Users can save search criteria with their email. When the collector finds new listings matching those criteria, an email notification is sent. Watchdogs are stored in SQLite and can be paused/resumed/deleted.

## Collector (TODO)

The `backend/collector.py` is a scaffold for the scraping engine. It should:

1. Run every 5 minutes
2. Fetch listings from all 3 sources
3. Parse and categorize (flat, house, commercial, garage, etc.)
4. Insert only new listings (dedup by `external_id`)
5. Check watchdog criteria and send email notifications

## License

MIT
