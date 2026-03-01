#!/usr/bin/env python3
"""
Flat Finder CZ - Real Estate Collector
=======================================
Fetches listings from Sreality.cz, Bezrealitky.cz, and UlovDomov.cz
and stores them in a SQLite database.

Designed to run every 5 minutes via cron or systemd timer.

Usage:
    python collector.py                  # use default DB_PATH
    DB_PATH=/data/listings.db python collector.py
    LOG_LEVEL=DEBUG python collector.py

Cron example (every 5 minutes):
    */5 * * * * DB_PATH=/path/to/data.db /usr/bin/python3 /path/to/collector.py >> /var/log/collector.log 2>&1
"""

import json
import logging
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DB_PATH = os.environ.get("DB_PATH", "data.db")
SREALITY_DELAY = float(os.environ.get("SREALITY_DELAY", "0.15"))    # seconds between requests
BEZREALITKY_DELAY = float(os.environ.get("BEZREALITKY_DELAY", "0.5"))
ULOVDOMOV_DELAY = float(os.environ.get("ULOVDOMOV_DELAY", "0.3"))
DETAIL_CONCURRENCY = int(os.environ.get("DETAIL_CONCURRENCY", "8"))  # concurrent detail fetches for Sreality
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

# Czech Republic bounding box for UlovDomov
CZ_BOUNDS = {
    "northEast": {"lat": 51.06, "lng": 18.87},
    "southWest": {"lat": 48.55, "lng": 12.09},
}

# Request timeout in seconds
REQUEST_TIMEOUT = 30

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("collector")


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db(db_path: str) -> sqlite3.Connection:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA synchronous=NORMAL")
    return db


def init_db(db: sqlite3.Connection) -> None:
    db.execute("""
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE,
      source TEXT NOT NULL,
      property_type TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      price REAL,
      currency TEXT DEFAULT 'CZK',
      price_note TEXT,
      address TEXT,
      city TEXT,
      district TEXT,
      region TEXT,
      latitude REAL,
      longitude REAL,
      size_m2 REAL,
      layout TEXT,
      floor INTEGER,
      total_floors INTEGER,
      condition TEXT,
      construction TEXT,
      ownership TEXT,
      furnishing TEXT,
      energy_rating TEXT,
      amenities TEXT,
      image_urls TEXT,
      thumbnail_url TEXT,
      source_url TEXT,
      listed_at TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1,
      deactivated_at TEXT
    )
    """)

    # Indexes
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city)",
        "CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price)",
        "CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source)",
        "CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type)",
        "CREATE INDEX IF NOT EXISTS idx_listings_transaction_type ON listings(transaction_type)",
        "CREATE INDEX IF NOT EXISTS idx_listings_is_active ON listings(is_active)",
        "CREATE INDEX IF NOT EXISTS idx_listings_external_id ON listings(external_id)",
    ]:
        db.execute(idx_sql)

    # Migration: add columns for older schemas
    for col_sql in [
        "ALTER TABLE listings ADD COLUMN is_active INTEGER DEFAULT 1",
        "ALTER TABLE listings ADD COLUMN deactivated_at TEXT",
    ]:
        try:
            db.execute(col_sql)
        except sqlite3.OperationalError:
            pass  # Column already exists

    db.execute("""
    CREATE TABLE IF NOT EXISTS watchdogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      filters TEXT NOT NULL,
      label TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_notified_at TEXT
    )
    """)
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_watchdogs_email ON watchdogs(email)",
        "CREATE INDEX IF NOT EXISTS idx_watchdogs_active ON watchdogs(active)",
    ]:
        db.execute(idx_sql)

    db.commit()


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def http_get(url: str, headers: dict = None, timeout: int = REQUEST_TIMEOUT) -> dict | list | str:
    """Perform a GET request and return parsed JSON (or raw text on failure)."""
    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/html,*/*",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
    }
    if headers:
        req_headers.update(headers)

    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def http_post(url: str, body: dict, headers: dict = None, timeout: int = REQUEST_TIMEOUT) -> dict:
    """Perform a POST request with a JSON body and return parsed JSON."""
    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        ),
        "Content-Type": "application/json",
        "Accept": "application/json, */*",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
    }
    if headers:
        req_headers.update(headers)

    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Database upsert helpers
# ---------------------------------------------------------------------------

def upsert_listing(db: sqlite3.Connection, listing: dict) -> tuple[bool, int]:
    """
    Insert or update a listing. Returns (is_new, rowid).

    Strategy:
    - INSERT OR REPLACE will delete + reinsert if external_id conflicts,
      which resets created_at. To preserve created_at we do a manual approach:
      1. Try INSERT (ignore on conflict)
      2. UPDATE the mutable fields
    """
    external_id = listing["external_id"]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # Check if already exists
    row = db.execute(
        "SELECT id, created_at FROM listings WHERE external_id = ?",
        [external_id]
    ).fetchone()
    is_new = row is None

    cols = [
        "external_id", "source", "property_type", "transaction_type",
        "title", "description", "price", "currency", "price_note",
        "address", "city", "district", "region",
        "latitude", "longitude", "size_m2", "layout",
        "floor", "total_floors", "condition", "construction", "ownership",
        "furnishing", "energy_rating", "amenities",
        "image_urls", "thumbnail_url", "source_url",
        "listed_at", "scraped_at", "is_active", "deactivated_at",
    ]

    if is_new:
        # Full insert including created_at
        all_cols = cols + ["created_at"]
        vals = [listing.get(c) for c in cols] + [now]
        placeholders = ", ".join(["?"] * len(all_cols))
        col_names = ", ".join(all_cols)
        db.execute(
            f"INSERT OR IGNORE INTO listings ({col_names}) VALUES ({placeholders})",
            vals,
        )
        rowid = db.execute(
            "SELECT id FROM listings WHERE external_id = ?", [external_id]
        ).fetchone()[0]
    else:
        # Update mutable fields but keep created_at
        mutable = [c for c in cols if c not in ("external_id", "source")]
        set_clause = ", ".join(f"{c} = ?" for c in mutable)
        vals = [listing.get(c) for c in mutable] + [external_id]
        db.execute(
            f"UPDATE listings SET {set_clause} WHERE external_id = ?",
            vals,
        )
        rowid = row[0]

    return is_new, rowid


def deactivate_stale_listings(
    db: sqlite3.Connection, source: str, seen_ids: set
) -> int:
    """
    Mark listings from `source` that were NOT seen in this run as inactive.
    Returns the count of newly deactivated listings.
    """
    if not seen_ids:
        logger.warning(
            "deactivate_stale_listings called with empty seen_ids for %s — skipping to avoid mass deactivation",
            source,
        )
        return 0

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # Fetch all active external_ids for this source
    rows = db.execute(
        "SELECT external_id FROM listings WHERE source = ? AND is_active = 1",
        [source],
    ).fetchall()
    active_ids = {r[0] for r in rows}

    stale = active_ids - seen_ids
    if not stale:
        return 0

    # Batch update in chunks to avoid huge IN clauses
    CHUNK = 500
    stale_list = list(stale)
    deactivated = 0
    for i in range(0, len(stale_list), CHUNK):
        chunk = stale_list[i : i + CHUNK]
        placeholders = ", ".join(["?"] * len(chunk))
        db.execute(
            f"UPDATE listings SET is_active = 0, deactivated_at = ? "
            f"WHERE external_id IN ({placeholders})",
            [now] + chunk,
        )
        deactivated += len(chunk)

    db.commit()
    logger.info("Deactivated %d stale listings for source=%s", deactivated, source)
    return deactivated


def reactivate_listing(db: sqlite3.Connection, external_id: str) -> None:
    """Reactivate a previously deactivated listing."""
    db.execute(
        "UPDATE listings SET is_active = 1, deactivated_at = NULL WHERE external_id = ?",
        [external_id],
    )


# ---------------------------------------------------------------------------
# Watchdog matching
# ---------------------------------------------------------------------------

def match_watchdogs(db: sqlite3.Connection, new_listing_ids: list[int]) -> int:
    """
    Check all active watchdogs against newly inserted listings.
    Logs matches. Returns the total number of matches found.

    Watchdog filter schema (JSON stored in watchdogs.filters):
    {
        "property_type": "flat",          # optional
        "transaction_type": "rent",       # optional
        "city": "Praha",                  # optional (substring match)
        "price_max": 25000,               # optional
        "price_min": 5000,                # optional
        "size_min": 40,                   # optional
        "size_max": 120,                  # optional
        "layout": "2+kk",                 # optional
        "source": "sreality",             # optional
    }
    """
    if not new_listing_ids:
        return 0

    watchdogs = db.execute(
        "SELECT id, email, filters FROM watchdogs WHERE active = 1"
    ).fetchall()

    if not watchdogs:
        return 0

    # Fetch new listings once
    placeholders = ", ".join(["?"] * len(new_listing_ids))
    new_listings = db.execute(
        f"SELECT * FROM listings WHERE id IN ({placeholders})",
        new_listing_ids,
    ).fetchall()

    total_matches = 0
    for wdog in watchdogs:
        try:
            filters = json.loads(wdog["filters"])
        except (json.JSONDecodeError, TypeError):
            filters = {}

        matches = []
        for listing in new_listings:
            if _listing_matches_watchdog(dict(listing), filters):
                matches.append(listing["id"])

        if matches:
            total_matches += len(matches)
            logger.info(
                "Watchdog #%d (%s) matched %d new listings: %s",
                wdog["id"], wdog["email"], len(matches), matches[:5],
            )
            # Email notifications are sent by notifier.py (time-based, SQL-driven).
            # notifier.py owns the last_notified_at field.

    return total_matches


def _listing_matches_watchdog(listing: dict, filters: dict) -> bool:
    """Return True if a listing matches all watchdog filter criteria."""
    if not filters:
        return True

    checks = [
        ("property_type", lambda l, v: l.get("property_type") == v),
        ("transaction_type", lambda l, v: l.get("transaction_type") == v),
        ("source", lambda l, v: l.get("source") == v),
        ("layout", lambda l, v: l.get("layout") == v),
        ("city", lambda l, v: v.lower() in (l.get("city") or "").lower()),
        ("price_min", lambda l, v: l.get("price") is not None and l["price"] >= float(v)),
        ("price_max", lambda l, v: l.get("price") is not None and l["price"] <= float(v)),
        ("size_min", lambda l, v: l.get("size_m2") is not None and l["size_m2"] >= float(v)),
        ("size_max", lambda l, v: l.get("size_m2") is not None and l["size_m2"] <= float(v)),
    ]

    for key, check_fn in checks:
        val = filters.get(key)
        if val is not None:
            if not check_fn(listing, val):
                return False
    return True


# ---------------------------------------------------------------------------
# ██████  ██████  ███████  █████  ██      ██ ████████ ██    ██
# ██      ██   ██ ██      ██   ██ ██      ██    ██     ██  ██
# ███████ ██████  █████   ███████ ██      ██    ██      ████
#      ██ ██   ██ ██      ██   ██ ██      ██    ██       ██
# ███████ ██   ██ ███████ ██   ██ ███████ ██    ██       ██
# ---------------------------------------------------------------------------

class SrealityCollector:
    """Fetches all listings from Sreality.cz via their JSON API."""

    BASE_URL = "https://www.sreality.cz/api/cs/v2"
    PER_PAGE = 60  # Maximum allowed

    # (category_main_cb, category_type_cb) combinations to fetch
    # category_main_cb: 1=flat, 2=house, 3=land, 4=commercial, 5=other
    # category_type_cb: 1=sale, 2=rent, 3=auction
    CATEGORIES = [
        (1, 1), (1, 2), (1, 3),  # flat: sale, rent, auction
        (2, 1), (2, 2), (2, 3),  # house: sale, rent, auction
        (3, 1),                   # land: sale only
        (4, 1), (4, 2),           # commercial: sale, rent
        (5, 1), (5, 2),           # other (garages etc.): sale, rent
    ]

    # Map category_main_cb -> property_type (fallback; sub_cb checked separately)
    PROPERTY_TYPE_MAP = {
        1: "flat",
        2: "house",
        3: "land",
        4: "commercial",
        5: "other",  # refined by sub_cb below
    }

    # Map category_type_cb -> transaction_type
    TRANSACTION_TYPE_MAP = {
        1: "sale",
        2: "rent",
        3: "auction",
    }

    # Garage sub-category code
    GARAGE_SUB_CB = 52

    def __init__(self, db: sqlite3.Connection, delay: float = SREALITY_DELAY):
        self.db = db
        self.delay = delay
        self.log = logging.getLogger("collector.sreality")

    def _fetch_page(self, category_main_cb: int, category_type_cb: int, page: int) -> dict:
        url = (
            f"{self.BASE_URL}/estates"
            f"?category_main_cb={category_main_cb}"
            f"&category_type_cb={category_type_cb}"
            f"&per_page={self.PER_PAGE}"
            f"&page={page}"
        )
        return http_get(url, headers={
            "Referer": "https://www.sreality.cz/",
            "X-Requested-With": "XMLHttpRequest",
        })

    def _fetch_detail(self, hash_id: int) -> dict | None:
        url = f"{self.BASE_URL}/estates/{hash_id}"
        try:
            return http_get(url, headers={
                "Referer": f"https://www.sreality.cz/detail/prodej/byt/{hash_id}",
            })
        except Exception as e:
            self.log.debug("Detail fetch failed for hash_id=%s: %s", hash_id, e)
            return None

    def _map_property_type(self, category_main_cb: int, category_sub_cb: int) -> str:
        if category_main_cb == 5:
            if category_sub_cb == self.GARAGE_SUB_CB:
                return "garage"
            return "other"
        return self.PROPERTY_TYPE_MAP.get(category_main_cb, "other")

    def _extract_layout_from_name(self, name: str) -> str | None:
        """Extract layout like '2+1', '3+kk' from listing name string."""
        if not name:
            return None
        # Match patterns like 2+1, 3+kk, 1+kk, 4+1, 5+kk, atypický
        m = re.search(r'(\d+\+(?:kk|\d))', name, re.IGNORECASE)
        if m:
            return m.group(1).lower().replace("kk", "kk")
        if re.search(r'atypick', name, re.IGNORECASE):
            return "atypický"
        return None

    def _parse_basic_listing(self, estate: dict) -> dict:
        """Parse a basic listing from the list endpoint."""
        hash_id = estate.get("hash_id")
        seo = estate.get("seo", {})
        cat_main = seo.get("category_main_cb", 0)
        cat_sub = seo.get("category_sub_cb", 0)
        cat_type = seo.get("category_type_cb", 0)

        # Prefer seo fields; fall back to top-level
        if cat_main == 0:
            cat_main = estate.get("category_main_cb", 0)
        if cat_type == 0:
            cat_type = estate.get("category_type_cb", 0)

        property_type = self._map_property_type(cat_main, cat_sub)
        transaction_type = self.TRANSACTION_TYPE_MAP.get(cat_type, "sale")

        name = estate.get("name", "")
        layout = self._extract_layout_from_name(name)

        # Price
        price = None
        price_czk = estate.get("price_czk", {})
        if price_czk:
            price = price_czk.get("value_raw")
        if not price:
            price = estate.get("price")

        # GPS
        gps = estate.get("gps", {})
        lat = gps.get("lat") if gps else None
        lng = gps.get("lon") if gps else None

        # Address / locality
        locality = estate.get("locality", "")

        # Images
        links = estate.get("_links", {})
        images_raw = links.get("images", [])
        image_urls = []
        for img in images_raw:
            href = img.get("href", "")
            # Sreality image URLs may be relative; make absolute
            if href and not href.startswith("http"):
                href = "https://cdn.sreality.cz" + href
            if href:
                image_urls.append(href)
        thumbnail_url = image_urls[0] if image_urls else None

        # Source URL
        source_url = f"https://www.sreality.cz/detail/{transaction_type}/{property_type}/{hash_id}"

        return {
            "external_id": f"sreality_{hash_id}",
            "source": "sreality",
            "property_type": property_type,
            "transaction_type": transaction_type,
            "title": name,
            "description": None,
            "price": float(price) if price else None,
            "currency": "CZK",
            "price_note": None,
            "address": locality,
            "city": self._extract_city(locality),
            "district": None,
            "region": None,
            "latitude": lat,
            "longitude": lng,
            "size_m2": self._extract_size_from_name(name),
            "layout": layout,
            "floor": None,
            "total_floors": None,
            "condition": None,
            "construction": None,
            "ownership": None,
            "furnishing": None,
            "energy_rating": None,
            "amenities": None,
            "image_urls": json.dumps(image_urls, ensure_ascii=False),
            "thumbnail_url": thumbnail_url,
            "source_url": source_url,
            "listed_at": None,
            "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "is_active": 1,
            "deactivated_at": None,
        }

    def _extract_city(self, locality: str) -> str | None:
        """Extract city from a Sreality locality string like 'Praha 2 - Vinohrady'."""
        if not locality:
            return None
        # Take last part after last comma if present (most specific location is usually last)
        parts = locality.split(",")
        city_part = parts[-1].strip() if len(parts) > 1 else parts[0].strip()
        # Remove district/neighbourhood suffixes like " - Vinohrady" or " 2 - Vinohrady"
        # e.g. "Praha 2 - Vinohrady" -> "Praha"
        city_part = re.sub(r'\s*-\s*\S.*$', '', city_part).strip()
        # Remove trailing district number: "Praha 2" -> "Praha", "Brno 1" -> "Brno"
        city_part = re.sub(r'\s+\d+$', '', city_part).strip()
        return city_part or None

    def _extract_size_from_name(self, name: str) -> float | None:
        """Extract size in m² from a listing name."""
        if not name:
            return None
        m = re.search(r'(\d+)\s*m[²2]', name, re.IGNORECASE)
        if m:
            return float(m.group(1))
        return None

    def _enrich_from_detail(self, listing: dict, detail: dict) -> dict:
        """Enrich a basic listing with data from the detail endpoint."""
        if not detail:
            return listing

        # Description
        text = detail.get("text", {})
        if isinstance(text, dict):
            listing["description"] = text.get("value")

        # GPS (more precise from detail)
        map_data = detail.get("map", {})
        if map_data:
            listing["latitude"] = map_data.get("lat", listing["latitude"])
            listing["longitude"] = map_data.get("lon", listing["longitude"])

        # Title (more precise)
        name_data = detail.get("name", {})
        if isinstance(name_data, dict) and name_data.get("value"):
            listing["title"] = name_data["value"]

        # Address
        locality = detail.get("locality", {})
        if isinstance(locality, dict) and locality.get("value"):
            listing["address"] = locality["value"]
            listing["city"] = self._extract_city(locality["value"])

        # Images
        embedded = detail.get("_embedded", {})
        images_raw = embedded.get("images", [])
        image_urls = []
        for img in images_raw:
            href = img.get("href", "")
            if href and not href.startswith("http"):
                href = "https://cdn.sreality.cz" + href
            if href:
                image_urls.append(href)
        if image_urls:
            listing["image_urls"] = json.dumps(image_urls, ensure_ascii=False)
            listing["thumbnail_url"] = image_urls[0]

        # Items array — property details
        items = detail.get("items", [])
        for item in items:
            item_name = (item.get("name") or "").strip()
            item_value = item.get("value")

            if item_value is None:
                continue

            # Handle nested value objects
            if isinstance(item_value, dict):
                item_value = item_value.get("value", item_value)
            if isinstance(item_value, list) and item_value:
                item_value = item_value[0]
                if isinstance(item_value, dict):
                    item_value = item_value.get("value", "")

            val_str = str(item_value).strip() if item_value else ""

            if item_name in ("Celková cena", "Cena"):
                # Already have price from list
                pass
            elif item_name == "Stavba":
                listing["construction"] = val_str
            elif item_name == "Stav objektu":
                listing["condition"] = val_str
            elif item_name == "Vlastnictví":
                listing["ownership"] = val_str
            elif item_name in ("Podlaží", "Podlaží z celku"):
                # e.g. "3. z 8" or "3"
                m = re.match(r'(\d+)', val_str)
                if m:
                    listing["floor"] = int(m.group(1))
                # total floors
                m2 = re.search(r'z\s+(\d+)', val_str)
                if m2:
                    listing["total_floors"] = int(m2.group(1))
            elif item_name in ("Užitná plocha", "Plocha"):
                m = re.search(r'(\d+(?:\.\d+)?)', val_str)
                if m:
                    listing["size_m2"] = float(m.group(1))
            elif item_name == "Energetická náročnost budovy":
                listing["energy_rating"] = val_str
            elif item_name == "Vybavení":
                listing["furnishing"] = val_str
            elif item_name == "Dispozice":
                layout = self._extract_layout_from_name(val_str) or val_str
                listing["layout"] = layout

        # listed_at from date fields (Sreality doesn't expose this cleanly)
        # Use scraped_at as listed_at if not set
        if not listing.get("listed_at"):
            listing["listed_at"] = listing["scraped_at"]

        return listing

    def collect(self) -> tuple[int, int, int]:
        """
        Collect all listings from Sreality.

        Returns (new_count, updated_count, error_count).
        """
        new_count = 0
        updated_count = 0
        error_count = 0
        seen_ids: set[str] = set()

        for cat_main, cat_type in self.CATEGORIES:
            cat_name = f"cat_main={cat_main} cat_type={cat_type}"
            self.log.info("Fetching Sreality: %s", cat_name)

            page = 1
            total_pages = 1

            while page <= total_pages:
                try:
                    data = self._fetch_page(cat_main, cat_type, page)
                    time.sleep(self.delay)
                except Exception as e:
                    self.log.error("Error fetching page %d of %s: %s", page, cat_name, e)
                    error_count += 1
                    break

                if not isinstance(data, dict):
                    self.log.error("Unexpected response type for %s page %d", cat_name, page)
                    break

                result_size = data.get("result_size", 0)
                if page == 1:
                    total_pages = max(1, -(-result_size // self.PER_PAGE))  # ceil division
                    self.log.info(
                        "  %s: %d listings, %d pages",
                        cat_name, result_size, total_pages,
                    )

                estates = data.get("_embedded", {}).get("estates", [])
                if not estates:
                    break

                # Phase 1: parse all estates and identify which need detail fetches
                parsed = []  # list of (listing, hash_id, existing_row, needs_detail)
                for estate in estates:
                    hash_id = estate.get("hash_id")
                    if not hash_id:
                        continue

                    external_id = f"sreality_{hash_id}"
                    seen_ids.add(external_id)

                    try:
                        listing = self._parse_basic_listing(estate)
                    except Exception as e:
                        self.log.debug("Parse error for hash_id=%s: %s", hash_id, e)
                        error_count += 1
                        continue

                    existing = self.db.execute(
                        "SELECT id, is_active FROM listings WHERE external_id = ?",
                        [external_id],
                    ).fetchone()

                    parsed.append((listing, hash_id, existing, existing is None))

                # Phase 2: fetch details concurrently for new listings
                needs_detail = [(l, h) for l, h, _, nd in parsed if nd]
                details: dict[int, dict | None] = {}
                if needs_detail:
                    with ThreadPoolExecutor(max_workers=DETAIL_CONCURRENCY) as pool:
                        future_to_hash = {
                            pool.submit(self._fetch_detail, h): h
                            for _, h in needs_detail
                        }
                        for future in as_completed(future_to_hash):
                            h = future_to_hash[future]
                            try:
                                details[h] = future.result()
                            except Exception as e:
                                self.log.debug("Detail fetch error for hash_id=%s: %s", h, e)
                                details[h] = None

                # Phase 3: enrich and upsert
                for listing, hash_id, existing, needs in parsed:
                    if needs and hash_id in details and details[hash_id]:
                        listing = self._enrich_from_detail(listing, details[hash_id])

                    if existing and existing["is_active"] == 0:
                        listing["is_active"] = 1
                        listing["deactivated_at"] = None

                    try:
                        is_new, _ = upsert_listing(self.db, listing)
                        if is_new:
                            new_count += 1
                        else:
                            updated_count += 1
                    except Exception as e:
                        self.log.error("DB error for %s: %s", listing["external_id"], e)
                        error_count += 1

                # Commit every page
                self.db.commit()
                page += 1

                if page <= total_pages:
                    time.sleep(self.delay)

        # Deactivate stale listings
        deactivated = deactivate_stale_listings(self.db, "sreality", seen_ids)
        self.log.info(
            "Sreality done: %d new, %d updated, %d errors, %d deactivated",
            new_count, updated_count, error_count, deactivated,
        )
        return new_count, updated_count, error_count


# ---------------------------------------------------------------------------
# ██████  ███████ ███████ ██████  ███████  █████  ██      ██ ████████ ██   ██ ██    ██
# ██   ██ ██      ╔═╝     ██   ██ ██      ██   ██ ██      ██    ██    ██  ██  ╚██  ██
# ██████  █████   ╔═╝     ██████  █████   ███████ ██      ██    ██    █████    ╚████
# ██   ██ ██              ██   ██ ██      ██   ██ ██      ██    ██    ██  ██    ██
# ██████  ███████         ██   ██ ███████ ██   ██ ███████ ██    ██    ██   ██   ██
# ---------------------------------------------------------------------------

class BezrealitkyCollector:
    """Fetches all listings from Bezrealitky.cz via their Next.js data route."""

    BASE_URL = "https://www.bezrealitky.cz"
    ITEMS_PER_PAGE = 15

    # (offer_slug, estate_slug) -> (transaction_type, property_type)
    SLUGS = [
        ("nabidka-pronajem", "byt",     "rent",  "flat"),
        ("nabidka-prodej",   "byt",     "sale",  "flat"),
        ("nabidka-pronajem", "dum",     "rent",  "house"),
        ("nabidka-prodej",   "dum",     "sale",  "house"),
        ("nabidka-prodej",   "pozemek", "sale",  "land"),
        ("nabidka-prodej",   "garaz",   "sale",  "garage"),
        ("nabidka-prodej",   "komercni-prostory", "sale", "commercial"),
        ("nabidka-pronajem", "komercni-prostory", "rent", "commercial"),
    ]

    DISPOSITION_MAP = {
        "DISP_1_KK":  "1+kk",
        "DISP_1_1":   "1+1",
        "DISP_2_KK":  "2+kk",
        "DISP_2_1":   "2+1",
        "DISP_3_KK":  "3+kk",
        "DISP_3_1":   "3+1",
        "DISP_4_KK":  "4+kk",
        "DISP_4_1":   "4+1",
        "DISP_5_KK":  "5+kk",
        "DISP_5_1":   "5+1",
        "DISP_6_KK":  "6+kk",
        "DISP_6_1":   "6+1",
        "DISP_GARSONIERA": "garsoniera",
        "DISP_ATYPICKY":   "atypický",
        "DISP_POKOJ":      "pokoj",
    }

    ESTATE_TYPE_MAP = {
        "BYT": "flat",
        "DUM": "house",
        "POZEMEK": "land",
        "GARAZ": "garage",
        "KOMERCNI_PROSTOR": "commercial",
        "ATELIER": "commercial",
        "KANCELAR": "commercial",
    }

    OFFER_TYPE_MAP = {
        "PRONAJEM": "rent",
        "PRODEJ": "sale",
        "AUKCE": "auction",
    }

    def __init__(self, db: sqlite3.Connection, delay: float = BEZREALITKY_DELAY):
        self.db = db
        self.delay = delay
        self.log = logging.getLogger("collector.bezrealitky")
        self._build_id: str | None = None

    def _get_build_id(self) -> str | None:
        """Fetch the Next.js buildId from the site HTML."""
        try:
            url = f"{self.BASE_URL}/vypis/nabidka-pronajem/byt"
            raw = http_get(url)
            if not isinstance(raw, str):
                raw = str(raw)
            # Extract __NEXT_DATA__ JSON
            m = re.search(
                r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
                raw, re.DOTALL,
            )
            if m:
                next_data = json.loads(m.group(1))
                return next_data.get("buildId")
        except Exception as e:
            self.log.error("Failed to extract buildId: %s", e)
        return None

    def _fetch_next_data(
        self, build_id: str, offer_slug: str, estate_slug: str, page: int
    ) -> dict | None:
        """Fetch a page of listings from the Next.js data endpoint."""
        url = (
            f"{self.BASE_URL}/_next/data/{build_id}/cs/vypis/"
            f"{offer_slug}/{estate_slug}.json"
            f"?slugs={offer_slug}&slugs={estate_slug}&page={page}"
        )
        try:
            return http_get(url, headers={"Referer": f"{self.BASE_URL}/vypis/{offer_slug}/{estate_slug}"})
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # buildId may have changed
                self.log.warning("404 on buildId=%s — will refresh", build_id)
                self._build_id = None
            else:
                self.log.error("HTTP %d fetching %s page %d: %s", e.code, offer_slug, page, e)
            return None
        except Exception as e:
            self.log.error("Error fetching %s/%s page %d: %s", offer_slug, estate_slug, page, e)
            return None

    def _parse_apollo_cache(self, apollo_cache: dict) -> list[dict]:
        """Extract Advert entries from Apollo normalized cache."""
        adverts = []
        for key, val in apollo_cache.items():
            if not key.startswith("Advert:"):
                continue
            if not isinstance(val, dict):
                continue
            adverts.append(self._parse_advert(key, val, apollo_cache))
        return adverts

    def _resolve_ref(self, ref_obj: dict | str, cache: dict) -> dict:
        """Resolve an Apollo __ref to its cached object."""
        if isinstance(ref_obj, dict) and "__ref" in ref_obj:
            return cache.get(ref_obj["__ref"], {})
        return ref_obj if isinstance(ref_obj, dict) else {}

    def _parse_advert(self, cache_key: str, advert: dict, cache: dict) -> dict:
        """Parse a single Advert from the Apollo cache."""
        advert_id = advert.get("id") or cache_key.replace("Advert:", "")
        external_id = f"bezrealitky_{advert_id}"

        # Types
        estate_type_raw = advert.get("estateType", "BYT")
        offer_type_raw = advert.get("offerType", "PRONAJEM")
        property_type = self.ESTATE_TYPE_MAP.get(estate_type_raw, "other")
        transaction_type = self.OFFER_TYPE_MAP.get(offer_type_raw, "sale")

        # Layout / disposition
        disposition_raw = advert.get("disposition", "")
        layout = self.DISPOSITION_MAP.get(disposition_raw)

        # Size
        surface = advert.get("surface")
        size_m2 = float(surface) if surface else None
        # Land area
        if not size_m2:
            surface_land = advert.get("surfaceLand")
            size_m2 = float(surface_land) if surface_land else None

        # Price
        price = advert.get("price")
        if price is not None:
            try:
                price = float(price)
            except (TypeError, ValueError):
                price = None
        charges = advert.get("charges") or 0
        currency = advert.get("currency", "CZK")

        # Price note
        price_note = f"+ {charges} Kč poplatky" if charges else None

        # GPS
        gps_raw = advert.get("gps", {})
        if isinstance(gps_raw, dict) and "__ref" in gps_raw:
            gps_raw = self._resolve_ref(gps_raw, cache)
        lat = gps_raw.get("lat") if isinstance(gps_raw, dict) else None
        lng = gps_raw.get("lng") if isinstance(gps_raw, dict) else None

        # Address — key may have locale suffix like address({"locale":"CS"})
        address_raw = ""
        for k in advert:
            if k.startswith("address") and not k.startswith("addressFormatted"):
                val = advert[k]
                if val and isinstance(val, str):
                    address_raw = val
                    break
        city = self._extract_city_from_address(address_raw)

        # Images
        image_urls = []
        thumbnail_url = None

        main_img_ref = advert.get("mainImage", {})
        if isinstance(main_img_ref, dict) and "__ref" in main_img_ref:
            main_img = self._resolve_ref(main_img_ref, cache)
            if main_img:
                thumbnail_url = self._extract_image_url(main_img, prefer="RECORD_THUMB")

        # publicImages key may contain GraphQL params like ({"limit":3})
        pub_images = None
        for k in advert:
            if k.startswith("publicImages"):
                pub_images = advert[k]
                break
        if not pub_images:
            pub_images = advert.get("images", [])
        for img_ref in (pub_images or []):
            img = self._resolve_ref(img_ref, cache)
            if isinstance(img, dict):
                full_url = self._extract_image_url(img, prefer="RECORD_MAIN")
                if full_url:
                    image_urls.append(full_url)

        if not thumbnail_url and image_urls:
            thumbnail_url = image_urls[0]

        # URI / source_url
        uri = advert.get("uri", "")
        if uri and not uri.startswith("http"):
            if not uri.startswith("/"):
                uri = "/" + uri
            source_url = f"{self.BASE_URL}{uri}"
        elif uri:
            source_url = uri
        else:
            source_url = f"{self.BASE_URL}/nemovitosti-byty-domy/{advert_id}"

        # Title — also look for imageAltText as a title source
        title = advert.get("seoName") or advert.get("name") or ""
        if not title:
            for k in advert:
                if k.startswith("imageAltText"):
                    title = advert[k] or ""
                    break
        if not title and layout and size_m2:
            trans_cz = {"rent": "Pronájem", "sale": "Prodej", "auction": "Aukce"}
            type_cz = {"flat": "bytu", "house": "domu", "land": "pozemku", "garage": "garáže", "commercial": "prostoru"}
            title = f"{trans_cz.get(transaction_type, 'Nabídka')} {type_cz.get(property_type, '')} {layout} {int(size_m2)} m²".strip()

        # Tags as amenities — key may have locale suffix
        tags_raw = None
        for k in advert:
            if k.startswith("tags"):
                tags_raw = advert[k]
                break
        if tags_raw is None:
            tags_raw = []
        if isinstance(tags_raw, list):
            amenities = ",".join(str(t) for t in tags_raw if t)
        else:
            amenities = str(tags_raw) if tags_raw else None

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        return {
            "external_id": external_id,
            "source": "bezrealitky",
            "property_type": property_type,
            "transaction_type": transaction_type,
            "title": title,
            "description": advert.get("description"),
            "price": price,
            "currency": currency or "CZK",
            "price_note": price_note,
            "address": address_raw or None,
            "city": city,
            "district": None,
            "region": None,
            "latitude": lat,
            "longitude": lng,
            "size_m2": size_m2,
            "layout": layout,
            "floor": advert.get("floor"),
            "total_floors": advert.get("totalFloors"),
            "condition": advert.get("buildingCondition"),
            "construction": advert.get("buildingType"),
            "ownership": advert.get("ownership"),
            "furnishing": advert.get("furnished"),
            "energy_rating": advert.get("energyEfficiencyRating"),
            "amenities": amenities,
            "image_urls": json.dumps(image_urls, ensure_ascii=False),
            "thumbnail_url": thumbnail_url,
            "source_url": source_url,
            "listed_at": advert.get("createdAt") or advert.get("firstPublishedAt") or now,
            "scraped_at": now,
            "is_active": 1,
            "deactivated_at": None,
        }

    def _extract_image_url(self, img_obj: dict, prefer: str = "RECORD_MAIN") -> str | None:
        """Extract image URL from Apollo Image cache object.
        
        Image objects have keys like url({"filter":"RECORD_MAIN"}) or url({"filter":"RECORD_THUMB"}).
        Falls back to any url key found.
        """
        if not img_obj:
            return None
        # Try preferred filter first
        for key in img_obj:
            if key.startswith("url") and prefer in key:
                url = img_obj[key]
                if url and isinstance(url, str):
                    return self._normalize_url(url)
        # Fall back to any url key
        for key in img_obj:
            if key.startswith("url") and isinstance(img_obj[key], str) and img_obj[key]:
                return self._normalize_url(img_obj[key])
        # Direct url field
        url = img_obj.get("url")
        if url and isinstance(url, str):
            return self._normalize_url(url)
        return None

    def _normalize_url(self, url: str) -> str | None:
        """Normalize a Bezrealitky URL."""
        if not url:
            return None
        if url.startswith("http"):
            return url
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("/"):
            return "https://api.bezrealitky.cz" + url
        return url

    def _extract_city_from_address(self, address: str) -> str | None:
        """Extract city from address string like 'Vinohrady, Praha 2'."""
        if not address:
            return None
        parts = [p.strip() for p in address.split(",")]
        # Usually last part is city
        for part in reversed(parts):
            part = part.strip()
            if part:
                # Remove district number (Praha 2 -> Praha)
                city = re.sub(r'\s+\d+\s*$', '', part).strip()
                return city or part
        return None

    def _get_total_count(self, page_props: dict) -> int:
        """Extract total listing count from pageProps."""
        apollo = page_props.get("apolloCache", page_props.get("apolloState", {}))
        if not apollo:
            return 0
        for key, val in apollo.items():
            if key == "ROOT_QUERY" and isinstance(val, dict):
                for qkey, qval in val.items():
                    if "listAdverts" in qkey and isinstance(qval, dict):
                        return qval.get("totalCount", 0)
        return 0

    def collect(self) -> tuple[int, int, int]:
        """
        Collect all listings from Bezrealitky.

        Returns (new_count, updated_count, error_count).
        """
        new_count = 0
        updated_count = 0
        error_count = 0
        seen_ids: set[str] = set()

        # Get fresh buildId
        self._build_id = self._get_build_id()
        if not self._build_id:
            self.log.error("Could not get Bezrealitky buildId — skipping")
            return 0, 0, 1

        self.log.info("Bezrealitky buildId: %s", self._build_id)

        for offer_slug, estate_slug, transaction_type, property_type in self.SLUGS:
            slug_label = f"{offer_slug}/{estate_slug}"
            self.log.info("Fetching Bezrealitky: %s", slug_label)

            page = 1
            total_pages = 999  # Will be updated from first response

            while page <= total_pages:
                # Refresh buildId if invalidated
                if not self._build_id:
                    self._build_id = self._get_build_id()
                    if not self._build_id:
                        self.log.error("Could not refresh buildId for %s", slug_label)
                        error_count += 1
                        break

                data = self._fetch_next_data(
                    self._build_id, offer_slug, estate_slug, page
                )
                time.sleep(self.delay)

                if data is None:
                    break

                page_props = (
                    data.get("pageProps", {})
                    or data.get("props", {}).get("pageProps", {})
                )
                apollo_cache = (
                    page_props.get("apolloCache")
                    or page_props.get("apolloState")
                    or {}
                )

                if not apollo_cache:
                    self.log.warning("No apolloCache for %s page %d", slug_label, page)
                    break

                # Determine total count from ROOT_QUERY on first page
                if page == 1:
                    total_count = self._get_total_count(page_props)
                    if total_count > 0:
                        total_pages = max(1, -(-total_count // self.ITEMS_PER_PAGE))
                        self.log.info(
                            "  %s: %d listings, %d pages",
                            slug_label, total_count, total_pages,
                        )
                    else:
                        # Could be 0 or parsing issue; try at least 1 page
                        total_pages = 1

                # Parse adverts from Apollo cache
                adverts = self._parse_apollo_cache(apollo_cache)

                if not adverts:
                    self.log.debug("No adverts found in apolloCache for %s page %d", slug_label, page)
                    break

                for listing in adverts:
                    external_id = listing["external_id"]
                    seen_ids.add(external_id)

                    existing = self.db.execute(
                        "SELECT id, is_active FROM listings WHERE external_id = ?",
                        [external_id],
                    ).fetchone()

                    if existing and existing["is_active"] == 0:
                        listing["is_active"] = 1
                        listing["deactivated_at"] = None

                    try:
                        is_new, _ = upsert_listing(self.db, listing)
                        if is_new:
                            new_count += 1
                        else:
                            updated_count += 1
                    except Exception as e:
                        self.log.error("DB error for %s: %s", external_id, e)
                        error_count += 1

                self.db.commit()
                page += 1

                if page <= total_pages:
                    time.sleep(self.delay)

        deactivated = deactivate_stale_listings(self.db, "bezrealitky", seen_ids)
        self.log.info(
            "Bezrealitky done: %d new, %d updated, %d errors, %d deactivated",
            new_count, updated_count, error_count, deactivated,
        )
        return new_count, updated_count, error_count


# ---------------------------------------------------------------------------
# ██    ██ ██       ██████  ██    ██ ██████   ██████  ███    ███  ██████  ██    ██
# ██    ██ ██      ██    ██ ██    ██ ██   ██ ██    ██ ████  ████ ██    ██ ██    ██
# ██    ██ ██      ██    ██ ██    ██ ██   ██ ██    ██ ██ ████ ██ ██    ██ ██    ██
# ██    ██ ██      ██    ██  ██  ██  ██   ██ ██    ██ ██  ██  ██ ██    ██  ██  ██
#  ██████  ███████  ██████    ████   ██████   ██████  ██      ██  ██████    ████
# ---------------------------------------------------------------------------

class UlovDomovCollector:
    """Fetches all listings from UlovDomov.cz via their REST API."""

    API_URL = "https://ud.api.ulovdomov.cz/v1/offer/find"
    PER_PAGE = 20

    # (offer_type, property_type) combinations
    COMBINATIONS = [
        ("rent", "flat"),
        ("sale", "flat"),
        ("rent", "house"),
        ("sale", "house"),
        ("sale", "land"),
    ]

    DISPOSITION_MAP = {
        "onePlusKk":    "1+kk",
        "onePlusOne":   "1+1",
        "twoPlusKk":    "2+kk",
        "twoPlusOne":   "2+1",
        "threePlusKk":  "3+kk",
        "threePlusOne": "3+1",
        "fourPlusKk":   "4+kk",
        "fourPlusOne":  "4+1",
        "fivePlusKk":   "5+kk",
        "fivePlusOne":  "5+1",
        "sixPlusKk":    "6+kk",
        "sixPlusOne":   "6+1",
        "other":        "atypický",
        "atypical":     "atypický",
    }

    FURNISHING_MAP = {
        "furnished":       "furnished",
        "partlyFurnished": "partially",
        "unfurnished":     "unfurnished",
    }

    CONDITION_MAP = {
        "new":   "new_build",
        "good":  "good",
        "poor":  "before_renovation",
    }

    CONSTRUCTION_MAP = {
        "brick": "brick",
        "panel": "panel",
    }

    def __init__(self, db: sqlite3.Connection, delay: float = ULOVDOMOV_DELAY):
        self.db = db
        self.delay = delay
        self.log = logging.getLogger("collector.ulovdomov")

    def _fetch_page(self, offer_type: str, property_type: str, page: int) -> dict:
        url = f"{self.API_URL}?page={page}&perPage={self.PER_PAGE}&sorting=latest"
        body = {
            "offerType": offer_type,
            "propertyType": property_type,
            "bounds": CZ_BOUNDS,
        }
        return http_post(
            url,
            body=body,
            headers={
                "Origin": "https://www.ulovdomov.cz",
                "Referer": f"https://www.ulovdomov.cz/{'pronajem' if offer_type == 'rent' else 'prodej'}/byty",
            },
        )

    def _parse_offer(self, offer: dict, offer_type: str, property_type: str) -> dict:
        """Parse a single UlovDomov offer into a DB-ready dict."""
        offer_id = offer["id"]
        external_id = f"ulovdomov_{offer_id}"

        # Layout
        disposition_raw = offer.get("disposition", "other")
        layout = self.DISPOSITION_MAP.get(disposition_raw)

        # Price
        price = None
        currency = "CZK"
        if offer_type == "rent":
            rental = offer.get("rentalPrice", {}) or {}
            price = rental.get("value")
            currency = rental.get("currency", "CZK")
        else:
            selling = offer.get("sellingPrice", {}) or {}
            price = selling.get("value")
            currency = selling.get("currency", "CZK")

        if price is not None:
            try:
                price = float(price)
            except (TypeError, ValueError):
                price = None

        # Price note
        price_note = offer.get("priceNote")
        monthly_fees = offer.get("monthlyFeesPrice")
        if monthly_fees and not price_note:
            price_note = f"+ {monthly_fees} Kč poplatky"

        # Address parts
        street = (offer.get("street") or {}).get("title", "")
        village = (offer.get("village") or {}).get("title", "")
        village_part = (offer.get("villagePart") or {}).get("title", "")

        address_parts = [p for p in [street, village_part, village] if p]
        address = ", ".join(address_parts) if address_parts else None
        city = village or village_part or None

        # GPS
        geo = offer.get("geoCoordinates", {}) or {}
        lat = geo.get("lat")
        lng = geo.get("lng")

        # Images
        photos = offer.get("photos", []) or []
        image_urls = [p["path"] for p in photos if p.get("path")]
        thumbnail_url = image_urls[0] if image_urls else None

        # Amenities
        convenience = offer.get("convenience", []) or []
        house_conv = offer.get("houseConvenience", []) or []
        all_amenities = convenience + house_conv
        amenities = ",".join(all_amenities) if all_amenities else None

        # Floor
        floor_raw = offer.get("floorLevel")
        floor = None
        if floor_raw is not None:
            try:
                floor = int(floor_raw)
            except (TypeError, ValueError):
                pass

        # Listed at
        published = offer.get("published")
        if published:
            # Normalize to UTC-aware ISO string
            listed_at = published.replace("T", " ").split("+")[0]
        else:
            listed_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        # Furnished
        furnished_raw = offer.get("furnished")
        furnishing = self.FURNISHING_MAP.get(furnished_raw) if furnished_raw else None

        # Condition
        condition_raw = offer.get("buildingCondition")
        condition = self.CONDITION_MAP.get(condition_raw) if condition_raw else None

        # Construction
        construction_raw = offer.get("buildingType") or offer.get("material")
        construction = self.CONSTRUCTION_MAP.get(construction_raw) if construction_raw else None

        # Energy rating
        energy_rating = offer.get("energyEfficiencyRating")

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        return {
            "external_id": external_id,
            "source": "ulovdomov",
            "property_type": property_type,
            "transaction_type": offer_type,
            "title": offer.get("title"),
            "description": offer.get("description"),
            "price": price,
            "currency": currency or "CZK",
            "price_note": price_note,
            "address": address,
            "city": city,
            "district": None,
            "region": None,
            "latitude": lat,
            "longitude": lng,
            "size_m2": float(offer["area"]) if offer.get("area") else None,
            "layout": layout,
            "floor": floor,
            "total_floors": None,
            "condition": condition,
            "construction": construction,
            "ownership": None,
            "furnishing": furnishing,
            "energy_rating": energy_rating,
            "amenities": amenities,
            "image_urls": json.dumps(image_urls, ensure_ascii=False),
            "thumbnail_url": thumbnail_url,
            "source_url": offer.get("absoluteUrl"),
            "listed_at": listed_at,
            "scraped_at": now,
            "is_active": 1,
            "deactivated_at": None,
        }

    def collect(self) -> tuple[int, int, int]:
        """
        Collect all listings from UlovDomov.

        Returns (new_count, updated_count, error_count).
        """
        new_count = 0
        updated_count = 0
        error_count = 0
        seen_ids: set[str] = set()

        for offer_type, property_type in self.COMBINATIONS:
            combo_label = f"offer_type={offer_type} property_type={property_type}"
            self.log.info("Fetching UlovDomov: %s", combo_label)

            page = 1
            total_pages = 1

            while page <= total_pages:
                try:
                    data = self._fetch_page(offer_type, property_type, page)
                    time.sleep(self.delay)
                except Exception as e:
                    self.log.error("Error fetching %s page %d: %s", combo_label, page, e)
                    error_count += 1
                    break

                if not data.get("success"):
                    self.log.error("API returned success=false for %s page %d", combo_label, page)
                    break

                extra = data.get("extraData", {})
                if page == 1:
                    total_pages = extra.get("totalPages", 1)
                    total_count = extra.get("total", 0)
                    self.log.info(
                        "  %s: %d listings, %d pages",
                        combo_label, total_count, total_pages,
                    )

                offers = data.get("data", {}).get("offers", [])
                if not offers:
                    break

                for offer in offers:
                    try:
                        listing = self._parse_offer(offer, offer_type, property_type)
                    except Exception as e:
                        self.log.debug("Parse error for offer id=%s: %s", offer.get("id"), e)
                        error_count += 1
                        continue

                    external_id = listing["external_id"]
                    seen_ids.add(external_id)

                    existing = self.db.execute(
                        "SELECT id, is_active FROM listings WHERE external_id = ?",
                        [external_id],
                    ).fetchone()

                    if existing and existing["is_active"] == 0:
                        listing["is_active"] = 1
                        listing["deactivated_at"] = None

                    try:
                        is_new, _ = upsert_listing(self.db, listing)
                        if is_new:
                            new_count += 1
                        else:
                            updated_count += 1
                    except Exception as e:
                        self.log.error("DB error for %s: %s", external_id, e)
                        error_count += 1

                self.db.commit()
                page += 1

                if page <= total_pages:
                    time.sleep(self.delay)

        deactivated = deactivate_stale_listings(self.db, "ulovdomov", seen_ids)
        self.log.info(
            "UlovDomov done: %d new, %d updated, %d errors, %d deactivated",
            new_count, updated_count, error_count, deactivated,
        )
        return new_count, updated_count, error_count


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

def _run_source(source_name: str, collector_cls, db_path: str, started_at: str) -> dict:
    """
    Run a single source collector in its own thread with its own DB connection.
    Returns a result dict with counts and timing.
    """
    t0 = time.time()
    try:
        db = get_db(db_path)
        collector = collector_cls(db)
        new_count, updated_count, error_count = collector.collect()

        # Grab newly inserted IDs for watchdog matching later
        rows = db.execute(
            "SELECT id FROM listings WHERE source = ? AND created_at >= ? ORDER BY id DESC LIMIT ?",
            [source_name, started_at[:19], new_count + 1],
        ).fetchall()
        new_ids = [r[0] for r in rows]
        db.close()

        elapsed = time.time() - t0
        return {
            "source": source_name,
            "new": new_count,
            "updated": updated_count,
            "errors": error_count,
            "elapsed_s": round(elapsed, 1),
            "new_ids": new_ids,
        }
    except Exception as e:
        elapsed = time.time() - t0
        logger.error("Fatal error in %s collector: %s", source_name, e, exc_info=True)
        return {
            "source": source_name,
            "new": 0,
            "updated": 0,
            "errors": 1,
            "elapsed_s": round(elapsed, 1),
            "fatal_error": str(e),
            "new_ids": [],
        }


def run_collector(db_path: str = DB_PATH) -> dict:
    """
    Run all collectors in parallel. Each source runs in its own thread
    with its own DB connection. Failures in one do not affect others.

    Returns a summary dict with counts per source.
    """
    start_time = time.time()
    logger.info("=" * 60)
    logger.info("Flat Finder CZ Collector starting")
    logger.info("Database: %s", os.path.abspath(db_path))
    logger.info("=" * 60)

    # Ensure schema exists before spawning threads
    db = get_db(db_path)
    init_db(db)
    db.close()

    started_at = datetime.now(timezone.utc).isoformat()
    summary = {
        "started_at": started_at,
        "sources": {},
    }

    sources = [
        ("sreality",    SrealityCollector),
        ("bezrealitky", BezrealitkyCollector),
        ("ulovdomov",   UlovDomovCollector),
    ]

    all_new_ids: list[int] = []

    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        futures = {
            pool.submit(_run_source, name, cls, db_path, started_at): name
            for name, cls in sources
        }
        for future in as_completed(futures):
            result = future.result()
            name = result.pop("source")
            all_new_ids.extend(result.pop("new_ids"))
            summary["sources"][name] = result

    # Watchdog matching (single-threaded, after all sources complete)
    if all_new_ids:
        db = get_db(db_path)
        logger.info("Checking watchdogs for %d new listings...", len(all_new_ids))
        try:
            matches = match_watchdogs(db, all_new_ids)
            summary["watchdog_matches"] = matches
            logger.info("Watchdog matches: %d", matches)
        except Exception as e:
            logger.error("Watchdog matching error: %s", e)
            summary["watchdog_matches"] = 0
        db.close()

    total_elapsed = time.time() - start_time
    summary["total_elapsed_s"] = round(total_elapsed, 1)
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()

    logger.info("=" * 60)
    logger.info("Collection complete in %.1fs", total_elapsed)
    for src, stats in summary["sources"].items():
        logger.info(
            "  %-15s new=%-6d updated=%-6d errors=%-4d time=%.1fs",
            src, stats["new"], stats["updated"], stats["errors"], stats["elapsed_s"],
        )
    logger.info("=" * 60)

    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Flat Finder CZ - Real Estate Collector",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python collector.py
  python collector.py --loop --interval 300
  python collector.py --db /path/to/data.db
  python collector.py --source sreality
  DB_PATH=/path/to/data.db LOG_LEVEL=DEBUG python collector.py

Environment variables:
  DB_PATH          Path to SQLite database (default: data.db)
  LOG_LEVEL        Logging level: DEBUG, INFO, WARNING, ERROR (default: INFO)
  SREALITY_DELAY   Delay between Sreality requests in seconds (default: 0.15)
  BEZREALITKY_DELAY Delay between Bezrealitky requests (default: 0.5)
  ULOVDOMOV_DELAY  Delay between UlovDomov requests (default: 0.3)
  DETAIL_CONCURRENCY  Concurrent detail fetches for Sreality (default: 8)
        """,
    )
    parser.add_argument("--db", default=DB_PATH, help="Path to SQLite database")
    parser.add_argument(
        "--source",
        choices=["sreality", "bezrealitky", "ulovdomov", "all"],
        default="all",
        help="Which source to collect (default: all)",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Run continuously, repeating every --interval seconds",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=300,
        help="Seconds between collection runs when using --loop (default: 300)",
    )
    parser.add_argument(
        "--json-summary",
        action="store_true",
        help="Print JSON summary to stdout after completion",
    )

    args = parser.parse_args()

    def _run_once() -> dict:
        if args.source != "all":
            db = get_db(args.db)
            init_db(db)
            source_map = {
                "sreality":    lambda: SrealityCollector(db).collect(),
                "bezrealitky": lambda: BezrealitkyCollector(db).collect(),
                "ulovdomov":   lambda: UlovDomovCollector(db).collect(),
            }
            new_c, upd_c, err_c = source_map[args.source]()
            db.close()
            logger.info("Done: new=%d updated=%d errors=%d", new_c, upd_c, err_c)
            return {"sources": {args.source: {"new": new_c, "updated": upd_c, "errors": err_c}}}
        else:
            return run_collector(db_path=args.db)

    if args.loop:
        logger.info("Running in loop mode (interval=%ds). Press Ctrl+C to stop.", args.interval)
        try:
            while True:
                summary = _run_once()
                if args.json_summary:
                    print(json.dumps(summary, indent=2, ensure_ascii=False))
                logger.info("Next run in %ds...", args.interval)
                time.sleep(args.interval)
        except KeyboardInterrupt:
            logger.info("Stopped by user.")
            sys.exit(0)
    else:
        summary = _run_once()

        if args.json_summary:
            print(json.dumps(summary, indent=2, ensure_ascii=False))

        has_data = any(
            s.get("new", 0) > 0 or s.get("updated", 0) > 0
            for s in summary["sources"].values()
        )
        sys.exit(0 if has_data or not any(s.get("errors", 0) for s in summary["sources"].values()) else 1)
