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
import threading
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

# Per-source rate limiting and concurrency
SREALITY_RPS         = float(os.environ.get("SREALITY_RPS", "5"))
SREALITY_CONCURRENCY = int(os.environ.get("SREALITY_CONCURRENCY", "10"))
BEZREALITKY_RPS         = float(os.environ.get("BEZREALITKY_RPS", "3"))
BEZREALITKY_CONCURRENCY = int(os.environ.get("BEZREALITKY_CONCURRENCY", "5"))
ULOVDOMOV_RPS         = float(os.environ.get("ULOVDOMOV_RPS", "5"))
ULOVDOMOV_CONCURRENCY = int(os.environ.get("ULOVDOMOV_CONCURRENCY", "10"))

# Retry settings
MAX_RETRIES    = int(os.environ.get("MAX_RETRIES", "3"))
RETRY_BASE_SEC = float(os.environ.get("RETRY_BASE_SEC", "1.0"))

# Batch settings
PAGE_BATCH_MULTIPLIER = int(os.environ.get("PAGE_BATCH_MULTIPLIER", "2"))
DETAIL_BATCH_SIZE     = int(os.environ.get("DETAIL_BATCH_SIZE", "20"))

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
# Rate Limiter
# ---------------------------------------------------------------------------

class RateLimiter:
    """Thread-safe token-bucket rate limiter with concurrency control."""

    def __init__(self, rps: float, max_concurrent: int, name: str = ""):
        self._interval = 1.0 / rps if rps > 0 else 0.0
        self._lock = threading.Lock()
        self._last_time = 0.0
        self._semaphore = threading.Semaphore(max_concurrent)
        self._name = name
        self._log = logging.getLogger(f"collector.ratelimiter.{name}")

    def acquire(self):
        """Wait for rate limit token, then acquire concurrency slot."""
        # Rate limiting: spin until enough time has elapsed
        while True:
            with self._lock:
                now = time.monotonic()
                wait = self._last_time + self._interval - now
                if wait <= 0:
                    self._last_time = now
                    break
            time.sleep(wait)
        # Concurrency limiting
        self._semaphore.acquire()
        self._log.debug("Acquired slot")

    def release(self):
        """Release concurrency slot."""
        self._semaphore.release()
        self._log.debug("Released slot")

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()
        return False


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
      deactivated_at TEXT,
      seller_name TEXT,
      seller_phone TEXT,
      seller_email TEXT,
      seller_company TEXT,
      additional_params TEXT
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
        "ALTER TABLE listings ADD COLUMN seller_name TEXT",
        "ALTER TABLE listings ADD COLUMN seller_phone TEXT",
        "ALTER TABLE listings ADD COLUMN seller_email TEXT",
        "ALTER TABLE listings ADD COLUMN seller_company TEXT",
        "ALTER TABLE listings ADD COLUMN additional_params TEXT",
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
# Retry wrappers
# ---------------------------------------------------------------------------

_retry_log = logging.getLogger("collector.retry")


def _is_retryable(exc: Exception) -> bool:
    """Return True if the exception is transient and worth retrying."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code == 429 or exc.code >= 500
    if isinstance(exc, (urllib.error.URLError, TimeoutError, OSError)):
        return True
    return False


def _http_with_retry(
    fn,
    *args,
    rate_limiter: RateLimiter,
    max_retries: int = MAX_RETRIES,
    retry_base: float = RETRY_BASE_SEC,
    **kwargs,
):
    """Call *fn* with rate-limiting and exponential-backoff retry.

    Retries on HTTP 429, 5xx, URLError, TimeoutError, OSError.
    Does NOT retry on 4xx (except 429) or JSONDecodeError.
    """
    last_exc = None
    for attempt in range(max_retries):
        rate_limiter.acquire()
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            last_exc = exc
            if not _is_retryable(exc):
                raise
            backoff = retry_base * (2 ** attempt)
            _retry_log.warning(
                "Retry %d/%d after %.1fs — %s: %s",
                attempt + 1, max_retries, backoff, type(exc).__name__, exc,
            )
            time.sleep(backoff)
        finally:
            rate_limiter.release()
    # All retries exhausted — raise the last exception
    raise last_exc  # type: ignore[misc]


def http_get_with_retry(url: str, *, rate_limiter: RateLimiter, **kwargs):
    """http_get with rate-limiting and retry."""
    return _http_with_retry(http_get, url, rate_limiter=rate_limiter, **kwargs)


def http_post_with_retry(url: str, body: dict, *, rate_limiter: RateLimiter, **kwargs):
    """http_post with rate-limiting and retry."""
    return _http_with_retry(http_post, url, body, rate_limiter=rate_limiter, **kwargs)


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
        "seller_name", "seller_phone", "seller_email", "seller_company",
        "additional_params",
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

    # Czech URL slugs
    TRANSACTION_CZ = {"sale": "prodej", "rent": "pronajem", "auction": "drazby"}
    PROPERTY_CZ = {"flat": "byt", "house": "dum", "land": "pozemek",
                    "commercial": "komercni", "other": "ostatni", "garage": "garaz"}

    # category_sub_cb → URL slug for the disposition/type path segment
    SUB_SLUGS = {
        # Flats
        2: "1+kk", 3: "1+1", 4: "2+kk", 5: "2+1",
        6: "3+kk", 7: "3+1", 8: "4+kk", 9: "4+1",
        10: "5+kk", 11: "5+1", 12: "6-a-vice", 16: "atypicky", 47: "pokoj",
        # Houses
        33: "rodinny-dum", 35: "vila", 37: "chalupa", 39: "chata",
        43: "pamatka", 44: "na-klic", 46: "zemedelska-usedlost",
        # Land
        19: "bydleni", 20: "komercni", 21: "pole", 22: "louky",
        23: "lesy", 24: "rybniky", 25: "sady-vinice",
        # Commercial
        26: "kancelare", 27: "sklady", 28: "vyrobni", 29: "obchodni",
        30: "ubytovani", 31: "restaurace", 32: "zemedelske",
        36: "cinzovni-dum", 38: "virtualni-kancelar",
        # Other
        34: "ostatni", 48: "garazove-stani", 52: "garaz", 50: "vinny-sklep",
    }

    def __init__(self, db: sqlite3.Connection, delay: float = SREALITY_DELAY):
        self.db = db
        self.delay = delay
        self.log = logging.getLogger("collector.sreality")
        self.rate_limiter = RateLimiter(SREALITY_RPS, SREALITY_CONCURRENCY, "sreality")
        self._concurrency = SREALITY_CONCURRENCY

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

    def _fetch_page_with_retry(self, cat_main: int, cat_type: int, page: int) -> dict:
        """Fetch a list page with rate limiting and retry."""
        url = (
            f"{self.BASE_URL}/estates"
            f"?category_main_cb={cat_main}"
            f"&category_type_cb={cat_type}"
            f"&per_page={self.PER_PAGE}"
            f"&page={page}"
        )
        return http_get_with_retry(
            url,
            rate_limiter=self.rate_limiter,
            headers={
                "Referer": "https://www.sreality.cz/",
                "X-Requested-With": "XMLHttpRequest",
            },
        )

    def _fetch_detail(self, hash_id: int) -> dict | None:
        url = f"{self.BASE_URL}/estates/{hash_id}"
        try:
            return http_get(url, headers={
                "Referer": f"https://www.sreality.cz/detail/prodej/byt/{hash_id}",
            })
        except Exception as e:
            self.log.debug("Detail fetch failed for hash_id=%s: %s", hash_id, e)
            return None

    def _fetch_detail_with_retry(self, hash_id: int) -> dict | None:
        """Fetch detail for a single estate with rate limiting and retry."""
        url = f"{self.BASE_URL}/estates/{hash_id}"
        try:
            return http_get_with_retry(
                url,
                rate_limiter=self.rate_limiter,
                headers={
                    "Referer": f"https://www.sreality.cz/detail/prodej/byt/{hash_id}",
                },
            )
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

        # Source URL — needs Czech slugs and disposition in the path
        trans_cz = self.TRANSACTION_CZ.get(transaction_type, transaction_type)
        prop_cz = self.PROPERTY_CZ.get(property_type, property_type)
        sub_slug = self.SUB_SLUGS.get(cat_sub, "x")
        source_url = f"https://www.sreality.cz/detail/{trans_cz}/{prop_cz}/{sub_slug}/x/{hash_id}"

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
            "seller_name": None,
            "seller_phone": None,
            "seller_email": None,
            "seller_company": None,
            "additional_params": None,
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

        # Seller info
        embedded = detail.get("_embedded", {})
        seller = embedded.get("seller", {})
        if seller:
            listing["seller_name"] = seller.get("user_name") or None
            # Phone
            phones = seller.get("phones", [])
            if phones and isinstance(phones, list):
                first_phone = phones[0] if phones else {}
                if isinstance(first_phone, dict):
                    listing["seller_phone"] = first_phone.get("number") or first_phone.get("code") or None
                elif isinstance(first_phone, str):
                    listing["seller_phone"] = first_phone
            listing["seller_email"] = seller.get("email") or None
            # Company: try company_name first, then premise name
            company = seller.get("company_name")
            if not company:
                premise = seller.get("_embedded", {}).get("premise", {})
                if premise:
                    company = premise.get("name")
            listing["seller_company"] = company or None

        # Items array — property details
        mapped_item_names = {
            "Celková cena", "Cena", "Stavba", "Stav objektu", "Vlastnictví",
            "Podlaží", "Podlaží z celku", "Užitná plocha", "Plocha",
            "Energetická náročnost budovy", "Vybavení", "Dispozice",
        }
        extra_params = {}
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
            elif item_name and val_str:
                # Collect unmapped items into additional_params
                extra_params[item_name] = val_str

        if extra_params:
            listing["additional_params"] = json.dumps(extra_params, ensure_ascii=False)

        # listed_at from date fields (Sreality doesn't expose this cleanly)
        # Use scraped_at as listed_at if not set
        if not listing.get("listed_at"):
            listing["listed_at"] = listing["scraped_at"]

        return listing

    def _process_page_data(
        self, data: dict, seen_ids: set[str],
    ) -> tuple[int, int, int]:
        """Parse estates from a page, fetch details, enrich, upsert.

        Returns (new_count, updated_count, error_count) for this page.
        """
        new_count = 0
        updated_count = 0
        error_count = 0

        estates = data.get("_embedded", {}).get("estates", [])
        if not estates:
            return 0, 0, 0

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
                "SELECT id, is_active, description, seller_name FROM listings WHERE external_id = ?",
                [external_id],
            ).fetchone()

            needs = existing is None or (
                existing is not None
                and existing["description"] is None
                and existing["seller_name"] is None
            )
            parsed.append((listing, hash_id, existing, needs))

        # Phase 2: fetch details concurrently for listings that need it
        needs_detail = [(l, h) for l, h, _, nd in parsed if nd]
        details: dict[int, dict | None] = {}
        if needs_detail:
            with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
                future_to_hash = {
                    pool.submit(self._fetch_detail_with_retry, h): h
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

        self.db.commit()
        return new_count, updated_count, error_count

    def collect(self) -> tuple[int, int, int]:
        """
        Collect all listings from Sreality.

        Returns (new_count, updated_count, error_count).
        """
        new_count = 0
        updated_count = 0
        error_count = 0
        seen_ids: set[str] = set()
        batch_size = PAGE_BATCH_MULTIPLIER * self._concurrency

        for cat_main, cat_type in self.CATEGORIES:
            cat_name = f"cat_main={cat_main} cat_type={cat_type}"
            self.log.info("Fetching Sreality: %s", cat_name)

            # --- Fetch page 1 to discover total_pages ---
            try:
                data = self._fetch_page_with_retry(cat_main, cat_type, 1)
            except Exception as e:
                self.log.error("Error fetching page 1 of %s: %s", cat_name, e)
                error_count += 1
                continue

            if not isinstance(data, dict):
                self.log.error("Unexpected response type for %s page 1", cat_name)
                continue

            result_size = data.get("result_size", 0)
            total_pages = max(1, -(-result_size // self.PER_PAGE))
            self.log.info("  %s: %d listings, %d pages", cat_name, result_size, total_pages)

            # Process page 1 immediately
            n, u, e = self._process_page_data(data, seen_ids)
            new_count += n
            updated_count += u
            error_count += e

            if total_pages <= 1:
                continue

            # --- Batch-concurrent fetching of remaining pages ---
            remaining = list(range(2, total_pages + 1))

            for batch_start in range(0, len(remaining), batch_size):
                batch_pages = remaining[batch_start : batch_start + batch_size]
                self.log.info(
                    "  %s: Fetching pages %d-%d concurrently",
                    cat_name, batch_pages[0], batch_pages[-1],
                )

                page_results: dict[int, dict | None] = {}
                with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
                    future_to_page = {
                        pool.submit(self._fetch_page_with_retry, cat_main, cat_type, p): p
                        for p in batch_pages
                    }
                    for future in as_completed(future_to_page):
                        pg = future_to_page[future]
                        try:
                            page_results[pg] = future.result()
                        except Exception as exc:
                            self.log.error("Error fetching page %d of %s: %s", pg, cat_name, exc)
                            error_count += 1
                            page_results[pg] = None

                # Process in page order
                for pg in batch_pages:
                    pg_data = page_results.get(pg)
                    if pg_data is None or not isinstance(pg_data, dict):
                        continue
                    n, u, e = self._process_page_data(pg_data, seen_ids)
                    new_count += n
                    updated_count += u
                    error_count += e

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
        self.rate_limiter = RateLimiter(BEZREALITKY_RPS, BEZREALITKY_CONCURRENCY, "bezrealitky")
        self._concurrency = BEZREALITKY_CONCURRENCY

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

    def _fetch_next_data_with_retry(
        self, build_id: str, offer_slug: str, estate_slug: str, page: int,
    ) -> dict | None:
        """Fetch a page with rate limiting and retry. Invalidates _build_id on 404."""
        url = (
            f"{self.BASE_URL}/_next/data/{build_id}/cs/vypis/"
            f"{offer_slug}/{estate_slug}.json"
            f"?slugs={offer_slug}&slugs={estate_slug}&page={page}"
        )
        try:
            return http_get_with_retry(
                url,
                rate_limiter=self.rate_limiter,
                headers={"Referer": f"{self.BASE_URL}/vypis/{offer_slug}/{estate_slug}"},
            )
        except urllib.error.HTTPError as e:
            if e.code == 404:
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

        # URI / source_url — key may have locale suffix like uri({"locale":"CS"})
        uri = ""
        for k in advert:
            if k.startswith("uri"):
                val = advert[k]
                if val and isinstance(val, str):
                    uri = val
                    break
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

        # Additional params — collect extra Apollo fields not mapped to named columns
        extra_params = {}
        if charges:
            extra_params["charges"] = charges
        if surface:
            extra_params["surface"] = surface
        surface_land = advert.get("surfaceLand")
        if surface_land:
            extra_params["surfaceLand"] = surface_land
        if disposition_raw:
            extra_params["disposition_raw"] = disposition_raw
        for extra_key in ("balcony", "cellar", "garage", "loggia", "terrace",
                          "parking", "elevator", "garden"):
            val = advert.get(extra_key)
            if val is not None:
                extra_params[extra_key] = val
        additional_params = json.dumps(extra_params, ensure_ascii=False) if extra_params else None

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
            "seller_name": None,
            "seller_phone": None,
            "seller_email": None,
            "seller_company": None,
            "additional_params": additional_params,
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

    def _process_page_data(
        self, data: dict, seen_ids: set[str],
    ) -> tuple[int, int, int]:
        """Parse adverts from a page response, upsert into DB.

        Returns (new_count, updated_count, error_count) for this page.
        """
        new_count = 0
        updated_count = 0
        error_count = 0

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
            return 0, 0, 0

        adverts = self._parse_apollo_cache(apollo_cache)
        if not adverts:
            return 0, 0, 0

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
        return new_count, updated_count, error_count

    def collect(self) -> tuple[int, int, int]:
        """
        Collect all listings from Bezrealitky.

        Returns (new_count, updated_count, error_count).
        """
        new_count = 0
        updated_count = 0
        error_count = 0
        seen_ids: set[str] = set()
        batch_size = PAGE_BATCH_MULTIPLIER * self._concurrency

        # Get fresh buildId
        self._build_id = self._get_build_id()
        if not self._build_id:
            self.log.error("Could not get Bezrealitky buildId — skipping")
            return 0, 0, 1

        self.log.info("Bezrealitky buildId: %s", self._build_id)

        for offer_slug, estate_slug, transaction_type, property_type in self.SLUGS:
            slug_label = f"{offer_slug}/{estate_slug}"
            self.log.info("Fetching Bezrealitky: %s", slug_label)

            # Refresh buildId if invalidated
            if not self._build_id:
                self._build_id = self._get_build_id()
                if not self._build_id:
                    self.log.error("Could not refresh buildId for %s", slug_label)
                    error_count += 1
                    continue

            # --- Fetch page 1 to discover total_pages ---
            data = self._fetch_next_data_with_retry(
                self._build_id, offer_slug, estate_slug, 1,
            )
            if data is None:
                # Check if buildId was invalidated
                if not self._build_id:
                    self._build_id = self._get_build_id()
                continue

            page_props = (
                data.get("pageProps", {})
                or data.get("props", {}).get("pageProps", {})
            )
            total_count = self._get_total_count(page_props)
            if total_count > 0:
                total_pages = max(1, -(-total_count // self.ITEMS_PER_PAGE))
                self.log.info("  %s: %d listings, %d pages", slug_label, total_count, total_pages)
            else:
                total_pages = 1

            # Process page 1 immediately
            n, u, e = self._process_page_data(data, seen_ids)
            new_count += n
            updated_count += u
            error_count += e

            if total_pages <= 1:
                continue

            # --- Batch-concurrent fetching of remaining pages ---
            remaining = list(range(2, total_pages + 1))

            for batch_start in range(0, len(remaining), batch_size):
                batch_pages = remaining[batch_start : batch_start + batch_size]
                # Ensure buildId is still valid before each batch
                if not self._build_id:
                    self._build_id = self._get_build_id()
                    if not self._build_id:
                        self.log.error("Could not refresh buildId during %s", slug_label)
                        error_count += 1
                        break

                self.log.info(
                    "  %s: Fetching pages %d-%d concurrently",
                    slug_label, batch_pages[0], batch_pages[-1],
                )

                current_build_id = self._build_id
                page_results: dict[int, dict | None] = {}
                with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
                    future_to_page = {
                        pool.submit(
                            self._fetch_next_data_with_retry,
                            current_build_id, offer_slug, estate_slug, p,
                        ): p
                        for p in batch_pages
                    }
                    for future in as_completed(future_to_page):
                        pg = future_to_page[future]
                        try:
                            page_results[pg] = future.result()
                        except Exception as exc:
                            self.log.error("Error fetching %s page %d: %s", slug_label, pg, exc)
                            error_count += 1
                            page_results[pg] = None

                # Process in page order
                for pg in batch_pages:
                    pg_data = page_results.get(pg)
                    if pg_data is None:
                        continue
                    n, u, e = self._process_page_data(pg_data, seen_ids)
                    new_count += n
                    updated_count += u
                    error_count += e

                # Check if buildId was invalidated during this batch
                if not self._build_id:
                    self.log.warning("buildId invalidated during %s — breaking to next category", slug_label)
                    break

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
        self.rate_limiter = RateLimiter(ULOVDOMOV_RPS, ULOVDOMOV_CONCURRENCY, "ulovdomov")
        self._concurrency = ULOVDOMOV_CONCURRENCY

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
            "source_url": f"https://www.ulovdomov.cz/inzerat/x/{offer_id}",
            "listed_at": listed_at,
            "scraped_at": now,
            "is_active": 1,
            "deactivated_at": None,
            "seller_name": None,
            "seller_phone": None,
            "seller_email": None,
            "seller_company": None,
            "additional_params": None,
        }

    def _fetch_page_with_retry(self, offer_type: str, property_type: str, page: int) -> dict:
        """Fetch a list page with rate limiting and retry."""
        url = f"{self.API_URL}?page={page}&perPage={self.PER_PAGE}&sorting=latest"
        body = {
            "offerType": offer_type,
            "propertyType": property_type,
            "bounds": CZ_BOUNDS,
        }
        return http_post_with_retry(
            url,
            body,
            rate_limiter=self.rate_limiter,
            headers={
                "Origin": "https://www.ulovdomov.cz",
                "Referer": f"https://www.ulovdomov.cz/{'pronajem' if offer_type == 'rent' else 'prodej'}/byty",
            },
        )

    def _fetch_detail(self, offer_id: int) -> dict | None:
        """Fetch detail for a single UlovDomov offer."""
        url = f"https://ud.api.ulovdomov.cz/v1/offer/detail?offerId={offer_id}"
        try:
            return http_get(url, headers={
                "Origin": "https://www.ulovdomov.cz",
                "Referer": f"https://www.ulovdomov.cz/inzerat/x/{offer_id}",
            })
        except Exception as e:
            self.log.debug("Detail fetch failed for offer_id=%s: %s", offer_id, e)
            return None

    def _fetch_detail_with_retry(self, offer_id: int) -> dict | None:
        """Fetch detail with rate limiting and retry."""
        url = f"https://ud.api.ulovdomov.cz/v1/offer/detail?offerId={offer_id}"
        try:
            return http_get_with_retry(
                url,
                rate_limiter=self.rate_limiter,
                headers={
                    "Origin": "https://www.ulovdomov.cz",
                    "Referer": f"https://www.ulovdomov.cz/inzerat/x/{offer_id}",
                },
            )
        except Exception as e:
            self.log.debug("Detail fetch failed for offer_id=%s: %s", offer_id, e)
            return None

    def _enrich_from_detail(self, listing: dict, detail: dict) -> dict:
        """Enrich a listing with data from the detail endpoint."""
        if not detail:
            return listing

        data = detail.get("data", detail)

        # Seller info from owner
        owner = data.get("owner", {}) or {}
        if owner:
            first = owner.get("firstName", "") or ""
            surname = owner.get("surname", "") or ""
            name = f"{first} {surname}".strip()
            listing["seller_name"] = name or None
            listing["seller_phone"] = owner.get("phone") or None
            listing["seller_email"] = None  # UlovDomov doesn't provide email
            listing["seller_company"] = owner.get("type") or None

        # Description override from detail
        desc = data.get("description")
        if desc and not listing.get("description"):
            listing["description"] = desc

        # Additional params from parameters dict
        extra_params = {}
        parameters = data.get("parameters", {}) or {}
        for key, param in parameters.items():
            if not isinstance(param, dict):
                extra_params[key] = str(param)
                continue
            title = param.get("title", key)
            # Value can be direct or inside options
            value = param.get("value")
            if value is None:
                options = param.get("options", [])
                if options and isinstance(options, list):
                    selected = [o.get("title") or o.get("value") or str(o)
                                for o in options if isinstance(o, dict) and o.get("isActive")]
                    if not selected:
                        selected = [o.get("title") or o.get("value") or str(o)
                                    for o in options if isinstance(o, dict)]
                    value = ", ".join(selected) if selected else None
            if value is not None:
                extra_params[title] = str(value)

        if extra_params:
            listing["additional_params"] = json.dumps(extra_params, ensure_ascii=False)

        return listing

    def _process_page_data(
        self, data: dict, offer_type: str, property_type: str, seen_ids: set[str],
    ) -> tuple[int, int, int]:
        """Parse offers from a page, fetch details, enrich, upsert.

        Returns (new_count, updated_count, error_count) for this page.
        """
        new_count = 0
        updated_count = 0
        error_count = 0

        offers = data.get("data", {}).get("offers", [])
        if not offers:
            return 0, 0, 0

        # Phase 1: parse all offers and identify which need detail fetches
        parsed = []  # list of (listing, offer_id, existing, needs_detail)
        for offer in offers:
            try:
                listing = self._parse_offer(offer, offer_type, property_type)
            except Exception as e:
                self.log.debug("Parse error for offer id=%s: %s", offer.get("id"), e)
                error_count += 1
                continue

            external_id = listing["external_id"]
            seen_ids.add(external_id)
            offer_id = offer["id"]

            existing = self.db.execute(
                "SELECT id, is_active, seller_name FROM listings WHERE external_id = ?",
                [external_id],
            ).fetchone()

            needs_detail = existing is None or (
                existing is not None and existing["seller_name"] is None
            )
            parsed.append((listing, offer_id, existing, needs_detail))

        # Phase 2: fetch details concurrently for listings that need it
        needs_detail_list = [(l, oid) for l, oid, _, nd in parsed if nd]
        details: dict[int, dict | None] = {}
        if needs_detail_list:
            with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
                future_to_id = {
                    pool.submit(self._fetch_detail_with_retry, oid): oid
                    for _, oid in needs_detail_list
                }
                for future in as_completed(future_to_id):
                    oid = future_to_id[future]
                    try:
                        details[oid] = future.result()
                    except Exception as e:
                        self.log.debug("Detail fetch error for offer_id=%s: %s", oid, e)
                        details[oid] = None

        # Phase 3: enrich and upsert
        for listing, offer_id, existing, needs in parsed:
            if needs and offer_id in details and details[offer_id]:
                listing = self._enrich_from_detail(listing, details[offer_id])

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

        self.db.commit()
        return new_count, updated_count, error_count

    def collect(self) -> tuple[int, int, int]:
        """
        Collect all listings from UlovDomov.

        Returns (new_count, updated_count, error_count).
        """
        new_count = 0
        updated_count = 0
        error_count = 0
        seen_ids: set[str] = set()
        batch_size = PAGE_BATCH_MULTIPLIER * self._concurrency

        for offer_type, property_type in self.COMBINATIONS:
            combo_label = f"offer_type={offer_type} property_type={property_type}"
            self.log.info("Fetching UlovDomov: %s", combo_label)

            # --- Fetch page 1 to discover total_pages ---
            try:
                data = self._fetch_page_with_retry(offer_type, property_type, 1)
            except Exception as e:
                self.log.error("Error fetching page 1 of %s: %s", combo_label, e)
                error_count += 1
                continue

            if not data.get("success"):
                self.log.error("API returned success=false for %s page 1", combo_label)
                continue

            extra = data.get("extraData", {})
            total_pages = extra.get("totalPages", 1)
            total_count = extra.get("total", 0)
            self.log.info("  %s: %d listings, %d pages", combo_label, total_count, total_pages)

            # Process page 1 immediately
            n, u, e = self._process_page_data(data, offer_type, property_type, seen_ids)
            new_count += n
            updated_count += u
            error_count += e

            if total_pages <= 1:
                continue

            # --- Batch-concurrent fetching of remaining pages ---
            remaining = list(range(2, total_pages + 1))

            for batch_start in range(0, len(remaining), batch_size):
                batch_pages = remaining[batch_start : batch_start + batch_size]
                self.log.info(
                    "  %s: Fetching pages %d-%d concurrently",
                    combo_label, batch_pages[0], batch_pages[-1],
                )

                page_results: dict[int, dict | None] = {}
                with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
                    future_to_page = {
                        pool.submit(self._fetch_page_with_retry, offer_type, property_type, p): p
                        for p in batch_pages
                    }
                    for future in as_completed(future_to_page):
                        pg = future_to_page[future]
                        try:
                            page_results[pg] = future.result()
                        except Exception as exc:
                            self.log.error("Error fetching %s page %d: %s", combo_label, pg, exc)
                            error_count += 1
                            page_results[pg] = None

                # Process in page order
                for pg in batch_pages:
                    pg_data = page_results.get(pg)
                    if pg_data is None or not pg_data.get("success"):
                        if pg_data is not None:
                            self.log.error("API returned success=false for %s page %d", combo_label, pg)
                        continue
                    n, u, e = self._process_page_data(pg_data, offer_type, property_type, seen_ids)
                    new_count += n
                    updated_count += u
                    error_count += e

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
