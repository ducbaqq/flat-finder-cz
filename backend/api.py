#!/usr/bin/env python3
"""
Flat Finder CZ — Flask API Server
Serves the REST API and static frontend files.
"""

import json
import math
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS

app = Flask(__name__, static_folder=None)
CORS(app)

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "../data/flat_finder.db"
FRONTEND_DIR = BASE_DIR / "../frontend"


# ============================================
# Database
# ============================================

def get_db():
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_db(db):
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
    db.execute("CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_listings_transaction_type ON listings(transaction_type)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_listings_is_active ON listings(is_active)")

    # Migration: add columns if upgrading from older schema
    try:
        db.execute("ALTER TABLE listings ADD COLUMN is_active INTEGER DEFAULT 1")
    except:
        pass
    try:
        db.execute("ALTER TABLE listings ADD COLUMN deactivated_at TEXT")
    except:
        pass

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
    db.execute("CREATE INDEX IF NOT EXISTS idx_watchdogs_email ON watchdogs(email)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_watchdogs_active ON watchdogs(active)")
    db.commit()


def row_to_dict(row):
    d = dict(row)
    if d.get("image_urls"):
        try:
            d["image_urls"] = json.loads(d["image_urls"])
        except Exception:
            d["image_urls"] = []
    else:
        d["image_urls"] = []
    if d.get("amenities"):
        d["amenities"] = d["amenities"].split(",") if d["amenities"] else []
    else:
        d["amenities"] = []
    return d


def build_where_clause(params):
    conditions = []
    values = []

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
        val = params.get(param)
        if val:
            vals = val.split(",")
            if len(vals) > 1:
                placeholders = ",".join(["?"] * len(vals))
                conditions.append(f"{col} IN ({placeholders})")
                values.extend(vals)
            else:
                conditions.append(f"{col} = ?")
                values.append(val)

    price_min = params.get("price_min")
    if price_min:
        conditions.append("price >= ?")
        values.append(float(price_min))

    price_max = params.get("price_max")
    if price_max:
        conditions.append("price <= ?")
        values.append(float(price_max))

    size_min = params.get("size_min")
    if size_min:
        conditions.append("size_m2 >= ?")
        values.append(float(size_min))

    size_max = params.get("size_max")
    if size_max:
        conditions.append("size_m2 <= ?")
        values.append(float(size_max))

    amenities = params.get("amenities")
    if amenities:
        for a in amenities.split(","):
            conditions.append("amenities LIKE ?")
            values.append(f"%{a.strip()}%")

    location = params.get("location")
    if location:
        conditions.append("(city LIKE ? OR district LIKE ? OR region LIKE ? OR address LIKE ?)")
        like_val = f"%{location}%"
        values.extend([like_val, like_val, like_val, like_val])

    where = " AND ".join(conditions) if conditions else "1=1"
    # Always exclude inactive listings unless explicitly requested
    include_inactive = request.args.get("include_inactive")
    if not include_inactive:
        where = f"is_active = 1 AND ({where})"
    return where, values


def get_sort_clause(params):
    sort = params.get("sort", "newest")
    sort_map = {
        "newest": "listed_at DESC",
        "price_asc": "price ASC",
        "price_desc": "price DESC",
        "size_asc": "size_m2 ASC",
        "size_desc": "size_m2 DESC",
    }
    return sort_map.get(sort, "listed_at DESC")


# ============================================
# Database Status
# ============================================

def do_seed(db):
    """Return database status. Real data is populated by the collector."""
    total = db.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
    by_source = {}
    for row in db.execute("SELECT source, COUNT(*) FROM listings GROUP BY source"):
        by_source[row[0]] = row[1]
    return {
        "message": f"Database has {total} real listings",
        "total": total,
        "by_source": by_source,
        "seeded": False,
        "note": "Data is populated by collector.py (sreality.cz, bezrealitky.cz, ulovdomov.cz)"
    }


# ============================================
# Routes — Listings
# ============================================

@app.route("/api/listings", methods=["GET"])
def api_listings():
    db = get_db()
    init_db(db)

    params = request.args
    page = int(params.get("page", 1))
    per_page = min(int(params.get("per_page", 20)), 100)
    offset = (page - 1) * per_page

    where, values = build_where_clause(params)
    sort = get_sort_clause(params)

    total = db.execute(f"SELECT COUNT(*) FROM listings WHERE {where}", values).fetchone()[0]
    rows = db.execute(
        f"SELECT * FROM listings WHERE {where} ORDER BY {sort} LIMIT ? OFFSET ?",
        values + [per_page, offset]
    ).fetchall()

    listings = [row_to_dict(r) for r in rows]
    total_pages = math.ceil(total / per_page) if total > 0 else 1

    return jsonify({
        "listings": listings,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages
    })


@app.route("/api/listings/<int:listing_id>", methods=["GET"])
def api_listing_detail(listing_id):
    db = get_db()
    init_db(db)

    row = db.execute("SELECT * FROM listings WHERE id = ?", [listing_id]).fetchone()
    if row:
        return jsonify(row_to_dict(row))
    return jsonify({"error": "Listing not found"}), 404


# ============================================
# Routes — Markers
# ============================================

@app.route("/api/markers", methods=["GET"])
def api_markers():
    db = get_db()
    init_db(db)

    params = request.args
    where, values = build_where_clause(params)
    zoom = int(params.get("zoom", 7))

    rows = db.execute(
        f"SELECT id, title, price, thumbnail_url, latitude, longitude, property_type, transaction_type, layout, size_m2, city FROM listings WHERE {where} AND latitude IS NOT NULL AND longitude IS NOT NULL",
        values
    ).fetchall()

    precision = max(1, min(5, zoom - 4))
    factor = 10 ** precision

    clusters = {}
    for row in rows:
        lat_key = round(row["latitude"] * factor) / factor
        lng_key = round(row["longitude"] * factor) / factor
        key = f"{lat_key},{lng_key}"

        if key not in clusters:
            clusters[key] = {
                "lat": lat_key,
                "lng": lng_key,
                "count": 0,
                "listings": []
            }

        clusters[key]["count"] += 1
        if len(clusters[key]["listings"]) < 5:
            clusters[key]["listings"].append({
                "id": row["id"],
                "title": row["title"],
                "price": row["price"],
                "thumbnail_url": row["thumbnail_url"],
                "property_type": row["property_type"],
                "transaction_type": row["transaction_type"],
                "layout": row["layout"],
                "size_m2": row["size_m2"],
                "city": row["city"],
                "lat": row["latitude"],
                "lng": row["longitude"]
            })

    markers = list(clusters.values())
    return jsonify({"markers": markers, "total": len(rows)})


# ============================================
# Routes — Stats
# ============================================

@app.route("/api/stats", methods=["GET"])
def api_stats():
    db = get_db()
    init_db(db)

    total = db.execute("SELECT COUNT(*) FROM listings WHERE is_active = 1").fetchone()[0]
    total_all = db.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
    inactive = total_all - total

    by_source = {}
    for row in db.execute("SELECT source, COUNT(*) as cnt FROM listings WHERE is_active = 1 GROUP BY source"):
        by_source[row["source"]] = row["cnt"]

    by_type = {}
    for row in db.execute("SELECT property_type, COUNT(*) as cnt FROM listings WHERE is_active = 1 GROUP BY property_type"):
        by_type[row["property_type"]] = row["cnt"]

    by_transaction = {}
    for row in db.execute("SELECT transaction_type, COUNT(*) as cnt FROM listings WHERE is_active = 1 GROUP BY transaction_type"):
        by_transaction[row["transaction_type"]] = row["cnt"]

    by_city = {}
    for row in db.execute("SELECT city, COUNT(*) as cnt FROM listings WHERE is_active = 1 GROUP BY city ORDER BY cnt DESC LIMIT 10"):
        by_city[row["city"]] = row["cnt"]

    return jsonify({
        "total": total,
        "total_all": total_all,
        "inactive": inactive,
        "by_source": by_source,
        "by_type": by_type,
        "by_transaction": by_transaction,
        "by_city": by_city
    })


# ============================================
# Routes — Seed / Status
# ============================================

@app.route("/api/seed", methods=["GET"])
def api_seed():
    db = get_db()
    init_db(db)
    result = do_seed(db)
    return jsonify(result), 200


# ============================================
# Routes — Watchdogs
# ============================================

@app.route("/api/watchdogs", methods=["POST"])
def api_watchdog_create():
    db = get_db()
    init_db(db)

    body = request.get_json(force=True, silent=True) or {}
    email = body.get("email", "").strip()
    filters = body.get("filters", {})
    label = body.get("label", "").strip()

    if not email or "@" not in email:
        return jsonify({"error": "Valid email is required"}), 400

    db.execute(
        "INSERT INTO watchdogs (email, filters, label) VALUES (?, ?, ?)",
        [email, json.dumps(filters, ensure_ascii=False), label or None]
    )
    db.commit()

    wid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    return jsonify({"id": wid, "email": email, "filters": filters, "label": label, "active": True}), 201


@app.route("/api/watchdogs", methods=["GET"])
def api_watchdog_list():
    db = get_db()
    init_db(db)

    email = request.args.get("email")
    if not email:
        return jsonify({"error": "Email parameter required"}), 400

    rows = db.execute(
        "SELECT * FROM watchdogs WHERE email = ? ORDER BY created_at DESC",
        [email]
    ).fetchall()

    watchdogs = []
    for r in rows:
        w = dict(r)
        try:
            w["filters"] = json.loads(w["filters"])
        except Exception:
            w["filters"] = {}
        w["active"] = bool(w["active"])
        watchdogs.append(w)

    return jsonify({"watchdogs": watchdogs, "total": len(watchdogs)})


@app.route("/api/watchdogs/<int:watchdog_id>/toggle", methods=["PATCH"])
def api_watchdog_toggle(watchdog_id):
    db = get_db()
    init_db(db)

    db.execute(
        "UPDATE watchdogs SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?",
        [watchdog_id]
    )
    db.commit()

    row = db.execute("SELECT active FROM watchdogs WHERE id = ?", [watchdog_id]).fetchone()
    return jsonify({"id": watchdog_id, "active": bool(row["active"]) if row else False})


@app.route("/api/watchdogs/<int:watchdog_id>", methods=["DELETE"])
def api_watchdog_delete(watchdog_id):
    db = get_db()
    init_db(db)

    db.execute("DELETE FROM watchdogs WHERE id = ?", [watchdog_id])
    db.commit()
    return jsonify({"deleted": True})


# ============================================
# Serve Frontend Static Files
# ============================================

@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_frontend(path):
    return send_from_directory(str(FRONTEND_DIR), path)


# ============================================
# Main
# ============================================

if __name__ == "__main__":
    # Ensure data directory exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Check DB on startup
    db = get_db()
    init_db(db)
    total = db.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
    if total == 0:
        print("Database is empty — run collector.py to populate with real data.")
    else:
        print(f"Database has {total} listings.")
    db.close()

    print("Starting Flat Finder CZ API server on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False)
