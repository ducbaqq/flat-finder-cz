#!/usr/bin/env python3
"""
Flat Finder CZ - Watchdog Email Notifier
=========================================
Checks all active watchdogs against new listings and sends email
notifications via Brevo (Sendinblue) transactional API.

Designed to run every 30 minutes via cron or with --loop.

Usage:
    python notifier.py                          # single run
    python notifier.py --loop --interval 1800   # every 30 min
    python notifier.py --dry-run                # log matches without sending
    python notifier.py --json-summary           # print JSON summary to stdout

Cron example (every 30 minutes):
    */30 * * * * /usr/bin/python3 /path/to/notifier.py >> /var/log/notifier.log 2>&1
"""

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# .env loader (minimal, stdlib-only)
# ---------------------------------------------------------------------------

def load_dotenv():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
BREVO_TEMPLATE_ID = int(os.environ.get("BREVO_TEMPLATE_ID", "1"))
BREVO_SENDER_EMAIL = os.environ.get("BREVO_SENDER_EMAIL", "hlidac@flatfinder.cz")
BREVO_SENDER_NAME = os.environ.get("BREVO_SENDER_NAME", "Flat Finder CZ")
DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).resolve().parent.parent / "data" / "flat_finder.db"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "https://flatfinder.cz")

MAX_LISTINGS_PER_EMAIL = 20

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("notifier")

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

# ---------------------------------------------------------------------------
# Filter / SQL builder (adapted from api.py build_where_clause)
# ---------------------------------------------------------------------------

def build_watchdog_where_clause(filters: dict, cutoff: str) -> tuple[str, list]:
    """Build a WHERE clause from watchdog filter JSON.

    Always includes: is_active = 1 AND created_at > cutoff.
    Returns (where_string, values_list).
    """
    conditions = ["is_active = 1", "created_at > ?"]
    values: list = [cutoff]

    simple_filters = {
        "property_type": "property_type",
        "transaction_type": "transaction_type",
        "city": "city",
        "region": "region",
        "source": "source",
        "layout": "layout",
        "condition": "condition",
        "construction": "construction",
        "ownership": "ownership",
        "furnishing": "furnishing",
        "energy_rating": "energy_rating",
    }

    for param, col in simple_filters.items():
        val = filters.get(param)
        if val:
            val_str = str(val)
            vals = val_str.split(",")
            if len(vals) > 1:
                placeholders = ",".join(["?"] * len(vals))
                conditions.append(f"{col} IN ({placeholders})")
                values.extend(vals)
            else:
                conditions.append(f"{col} = ?")
                values.append(val_str)

    price_min = filters.get("price_min")
    if price_min is not None:
        conditions.append("price >= ?")
        values.append(float(price_min))

    price_max = filters.get("price_max")
    if price_max is not None:
        conditions.append("price <= ?")
        values.append(float(price_max))

    size_min = filters.get("size_min")
    if size_min is not None:
        conditions.append("size_m2 >= ?")
        values.append(float(size_min))

    size_max = filters.get("size_max")
    if size_max is not None:
        conditions.append("size_m2 <= ?")
        values.append(float(size_max))

    amenities = filters.get("amenities")
    if amenities:
        amenity_str = str(amenities)
        for a in amenity_str.split(","):
            conditions.append("amenities LIKE ?")
            values.append(f"%{a.strip()}%")

    location = filters.get("location")
    if location:
        conditions.append("(city LIKE ? OR district LIKE ? OR region LIKE ? OR address LIKE ?)")
        like_val = f"%{location}%"
        values.extend([like_val, like_val, like_val, like_val])

    where = " AND ".join(conditions)
    return where, values

# ---------------------------------------------------------------------------
# Price formatting
# ---------------------------------------------------------------------------

def format_price(price, currency="CZK", transaction_type=None):
    """Format price Czech-style: 25 000 Kč or 25 000 Kč/měs."""
    if price is None:
        return "Cena na vyžádání"
    p = int(round(price))
    formatted = f"{p:,}".replace(",", "\u00a0")  # non-breaking space
    suffix = "Kč"
    if transaction_type == "rent":
        suffix = "Kč/měs."
    return f"{formatted} {suffix}"

# ---------------------------------------------------------------------------
# Listing → email template params
# ---------------------------------------------------------------------------

def listing_to_email_params(row: dict) -> dict:
    """Convert a DB listing row to a dict suitable for Brevo template params."""
    source = row.get("source", "")
    listing_url = row.get("source_url") or ""
    return {
        "title": row.get("title") or "Bez názvu",
        "price_formatted": format_price(row.get("price"), row.get("currency", "CZK"), row.get("transaction_type")),
        "city": row.get("city") or "",
        "size_m2": row.get("size_m2") or "",
        "layout": row.get("layout") or "",
        "property_type": row.get("property_type") or "",
        "transaction_type": row.get("transaction_type") or "",
        "source": source,
        "thumbnail_url": row.get("thumbnail_url") or "",
        "listing_url": listing_url,
        "source_url": listing_url,
    }

# ---------------------------------------------------------------------------
# Brevo API
# ---------------------------------------------------------------------------

def send_brevo_email(to_email: str, template_id: int, params: dict) -> bool:
    """Send a transactional email via Brevo API. Returns True on success."""
    url = "https://api.brevo.com/v3/smtp/email"
    payload = {
        "to": [{"email": to_email}],
        "templateId": template_id,
        "params": params,
        "sender": {"email": BREVO_SENDER_EMAIL, "name": BREVO_SENDER_NAME},
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": BREVO_API_KEY,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            logger.info("Brevo API responded %d for %s", resp.status, to_email)
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        logger.error("Brevo API HTTP %d for %s: %s", e.code, to_email, body[:500])
        return False
    except urllib.error.URLError as e:
        logger.error("Brevo API network error for %s: %s", to_email, e.reason)
        return False

# ---------------------------------------------------------------------------
# Main notifier logic
# ---------------------------------------------------------------------------

def run_notifier(db_path: str, dry_run: bool = False) -> list[dict]:
    """Run one notification cycle. Returns a summary list of actions taken."""
    db = get_db(db_path)
    summary = []

    watchdogs = db.execute(
        "SELECT id, email, filters, label, created_at, last_notified_at "
        "FROM watchdogs WHERE active = 1"
    ).fetchall()

    if not watchdogs:
        logger.info("No active watchdogs found")
        db.close()
        return summary

    logger.info("Processing %d active watchdogs", len(watchdogs))

    for wdog in watchdogs:
        wdog_id = wdog["id"]
        email = wdog["email"]
        label = wdog["label"] or f"Hlídač #{wdog_id}"

        try:
            filters = json.loads(wdog["filters"])
        except (json.JSONDecodeError, TypeError):
            filters = {}

        # Cutoff: last_notified_at or created_at for never-notified watchdogs
        cutoff = wdog["last_notified_at"] or wdog["created_at"]
        if not cutoff:
            cutoff = "1970-01-01 00:00:00"

        where, values = build_watchdog_where_clause(filters, cutoff)

        # Count total matches first
        total_count = db.execute(
            f"SELECT COUNT(*) FROM listings WHERE {where}", values
        ).fetchone()[0]

        if total_count == 0:
            logger.debug("Watchdog #%d (%s): 0 new listings since %s", wdog_id, email, cutoff)
            continue

        # Fetch up to MAX+1 to detect overflow
        rows = db.execute(
            f"SELECT * FROM listings WHERE {where} ORDER BY created_at DESC LIMIT ?",
            values + [MAX_LISTINGS_PER_EMAIL + 1],
        ).fetchall()

        has_more = len(rows) > MAX_LISTINGS_PER_EMAIL
        listings_to_send = rows[:MAX_LISTINGS_PER_EMAIL]
        extra_count = total_count - MAX_LISTINGS_PER_EMAIL if has_more else 0

        listing_params = [listing_to_email_params(dict(r)) for r in listings_to_send]

        params = {
            "watchdog_label": label,
            "listing_count": total_count,
            "has_more": has_more,
            "extra_count": extra_count,
            "listings": listing_params,
            "app_url": APP_BASE_URL,
        }

        entry = {
            "watchdog_id": wdog_id,
            "email": email,
            "listing_count": total_count,
            "sent": False,
            "dry_run": dry_run,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        }

        if dry_run:
            logger.info(
                "DRY RUN — Watchdog #%d (%s): %d new listings (has_more=%s, extra=%d)",
                wdog_id, email, total_count, has_more, extra_count,
            )
            entry["sent"] = True
        else:
            if not BREVO_API_KEY:
                logger.error("BREVO_API_KEY not set — cannot send email. Use --dry-run to test.")
                entry["error"] = "BREVO_API_KEY not set"
            else:
                success = send_brevo_email(email, BREVO_TEMPLATE_ID, params)
                entry["sent"] = success

                if success:
                    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    db.execute(
                        "UPDATE watchdogs SET last_notified_at = ? WHERE id = ?",
                        [now, wdog_id],
                    )
                    db.commit()
                    logger.info(
                        "Watchdog #%d (%s): sent %d listings, updated last_notified_at",
                        wdog_id, email, total_count,
                    )
                else:
                    logger.warning(
                        "Watchdog #%d (%s): email send failed, skipping last_notified_at update",
                        wdog_id, email,
                    )

        summary.append(entry)

    db.close()
    return summary

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Flat Finder CZ — Watchdog Email Notifier",
    )
    parser.add_argument(
        "--loop", action="store_true",
        help="Run continuously instead of a single pass",
    )
    parser.add_argument(
        "--interval", type=int, default=1800,
        help="Seconds between runs when --loop is used (default: 1800)",
    )
    parser.add_argument(
        "--db", type=str, default=DB_PATH,
        help=f"Path to SQLite database (default: {DB_PATH})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Log matches without sending emails",
    )
    parser.add_argument(
        "--json-summary", action="store_true",
        help="Print JSON summary to stdout after each run",
    )
    args = parser.parse_args()

    logger.info("Notifier starting (dry_run=%s, loop=%s, interval=%ds, db=%s)",
                args.dry_run, args.loop, args.interval, args.db)

    while True:
        try:
            summary = run_notifier(args.db, dry_run=args.dry_run)
            if args.json_summary:
                print(json.dumps(summary, indent=2, ensure_ascii=False))
            sent = sum(1 for s in summary if s["sent"])
            logger.info("Run complete: %d watchdogs processed, %d emails sent", len(summary), sent)
        except Exception:
            logger.exception("Error during notifier run")

        if not args.loop:
            break

        logger.info("Sleeping %d seconds until next run", args.interval)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
