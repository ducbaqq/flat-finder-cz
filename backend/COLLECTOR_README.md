# Flat Finder CZ — Real Estate Collector

A production-ready Python script that fetches ALL Czech real estate listings from three sources and stores them in a SQLite database. Designed to run every 5 minutes via cron or systemd.

## Sources

| Source | Types | ~Listings |
|--------|-------|-----------|
| [Sreality.cz](https://www.sreality.cz) | Flats, houses, land, commercial, garages | ~90,000+ |
| [Bezrealitky.cz](https://www.bezrealitky.cz) | Flats, houses, land, garages, commercial | ~9,000 |
| [UlovDomov.cz](https://www.ulovdomov.cz) | Flats, houses, land | ~6,500 |

## Requirements

- Python 3.10+
- No external packages — stdlib only (`sqlite3`, `urllib`, `json`, `re`, `logging`)

## Usage

### Basic run

```bash
python collector.py
```

Uses `data.db` in the current directory by default.

### Custom database path

```bash
DB_PATH=/path/to/data.db python collector.py
```

### Run a single source

```bash
python collector.py --source sreality
python collector.py --source bezrealitky
python collector.py --source ulovdomov
```

### JSON summary output

```bash
python collector.py --json-summary
```

Prints a JSON object with new/updated/error counts per source after completion.

### Debug logging

```bash
LOG_LEVEL=DEBUG python collector.py
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `data.db` | Path to SQLite database file |
| `LOG_LEVEL` | `INFO` | Log level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SREALITY_DELAY` | `0.15` | Seconds between Sreality requests |
| `BEZREALITKY_DELAY` | `0.5` | Seconds between Bezrealitky requests |
| `ULOVDOMOV_DELAY` | `0.3` | Seconds between UlovDomov requests |

## Cron Setup (every 5 minutes)

```cron
*/5 * * * * DB_PATH=/path/to/data.db /usr/bin/python3 /path/to/collector.py >> /var/log/flat-finder-collector.log 2>&1
```

Or with log rotation:

```cron
*/5 * * * * DB_PATH=/path/to/data.db /usr/bin/python3 /path/to/collector.py 2>&1 | logger -t flat-finder-collector
```

## Systemd Timer (alternative to cron)

**`/etc/systemd/system/flat-finder-collector.service`:**
```ini
[Unit]
Description=Flat Finder CZ Real Estate Collector
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/flat-finder-cz-collector/collector.py
Environment=DB_PATH=/opt/flat-finder-cz/data.db
Environment=LOG_LEVEL=INFO
WorkingDirectory=/opt/flat-finder-cz-collector
User=www-data
```

**`/etc/systemd/system/flat-finder-collector.timer`:**
```ini
[Unit]
Description=Run Flat Finder collector every 5 minutes

[Timer]
OnBootSec=60
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
systemctl enable --now flat-finder-collector.timer
```

## Database Schema

The collector writes to a SQLite database with the following structure:

```sql
CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE,          -- e.g. "sreality_12345"
  source TEXT NOT NULL,             -- "sreality" | "bezrealitky" | "ulovdomov"
  property_type TEXT NOT NULL,      -- "flat" | "house" | "land" | "commercial" | "garage" | ...
  transaction_type TEXT NOT NULL,   -- "rent" | "sale" | "auction" | "flatshare"
  title TEXT,
  description TEXT,
  price REAL,
  currency TEXT DEFAULT 'CZK',
  price_note TEXT,                  -- e.g. "+ 3000 Kč poplatky"
  address TEXT,
  city TEXT,
  district TEXT,
  region TEXT,
  latitude REAL,
  longitude REAL,
  size_m2 REAL,
  layout TEXT,                      -- "1+kk", "2+1", "3+kk", etc.
  floor INTEGER,
  total_floors INTEGER,
  condition TEXT,
  construction TEXT,
  ownership TEXT,
  furnishing TEXT,
  energy_rating TEXT,
  amenities TEXT,                   -- comma-separated
  image_urls TEXT,                  -- JSON array string
  thumbnail_url TEXT,
  source_url TEXT,
  listed_at TEXT,
  scraped_at TEXT,
  created_at TEXT,
  is_active INTEGER DEFAULT 1,
  deactivated_at TEXT
);
```

## Incremental Updates

The collector is designed for efficiency on repeated 5-minute runs:

1. **New listings**: Inserted with full data. For Sreality, the detail API is called to enrich floor, condition, ownership, etc.
2. **Existing listings**: Updated with latest price, status, and images.
3. **Deactivation**: After each full source sweep, any listing that was NOT seen in the current run is marked `is_active=0` with a `deactivated_at` timestamp.
4. **Reactivation**: If a previously deactivated listing reappears, it is automatically reactivated (`is_active=1`, `deactivated_at=NULL`).

## Watchdog Matching

After each run, active watchdogs (stored in the `watchdogs` table) are checked against newly inserted listings. Matching is logged. Email sending is a TODO — implement in the `match_watchdogs()` function.

Watchdog filter JSON schema:
```json
{
  "property_type": "flat",
  "transaction_type": "rent",
  "city": "Praha",
  "price_max": 25000,
  "price_min": 5000,
  "size_min": 40,
  "size_max": 120,
  "layout": "2+kk",
  "source": "sreality"
}
```

## Architecture

```
collector.py
├── SrealityCollector
│   ├── _fetch_page()       — GET /api/cs/v2/estates?...
│   ├── _fetch_detail()     — GET /api/cs/v2/estates/{hash_id}  (new listings only)
│   ├── _parse_basic_listing()
│   ├── _enrich_from_detail()
│   └── collect()           — Paginates all categories, upserts, deactivates stale
│
├── BezrealitkyCollector
│   ├── _get_build_id()     — Extracts Next.js buildId from HTML
│   ├── _fetch_next_data()  — GET /_next/data/{buildId}/cs/vypis/...
│   ├── _parse_apollo_cache()
│   ├── _parse_advert()
│   └── collect()           — Paginates all offer/estate slug combos
│
├── UlovDomovCollector
│   ├── _fetch_page()       — POST /v1/offer/find
│   ├── _parse_offer()
│   └── collect()           — Paginates all offerType/propertyType combos
│
├── upsert_listing()        — INSERT or UPDATE with created_at preservation
├── deactivate_stale_listings()
├── match_watchdogs()
└── run_collector()         — Orchestrates all sources, handles errors per-source
```

## Expected Runtime

| Source | Listings | Pages | Est. Time (5min run) |
|--------|----------|-------|----------------------|
| Sreality | ~90,000 | ~1,500 | ~10–15 min (first run) / ~2 min (incremental) |
| Bezrealitky | ~9,000 | ~600 | ~5 min |
| UlovDomov | ~6,500 | ~330 | ~2 min |

On the first run, Sreality will be slow because it fetches the detail endpoint for every new listing. On subsequent runs, only genuinely new listings trigger detail fetches, making incremental runs much faster.

## Error Handling

- Each source collector is wrapped in a `try/except` — a failure in one source does not affect the others.
- Per-page errors are logged and skipped; collection continues with the next page.
- HTTP errors (rate limiting, temporary unavailability) are caught and logged.
- The script exits with code `0` on success or partial success, `1` if all sources errored.
