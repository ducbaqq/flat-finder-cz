#!/usr/bin/env python3
"""
Flat Finder CZ — Flask API Server
Serves the REST API and static frontend files.
"""

import json
import math
import re
import random
import hashlib
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
# Seed Data
# ============================================

def do_seed(db):
    existing = db.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
    if existing > 0:
        return {"message": f"Database already has {existing} listings", "seeded": False}

    random.seed(42)

    sources = ["sreality", "bezrealitky", "ulovdomov"]
    property_types_weights = [("flat", 50), ("house", 20), ("commercial", 10), ("garage", 10), ("land", 4), ("cottage", 3), ("residential_building", 3)]
    transaction_types_weights = [("rent", 70), ("sale", 30)]
    conditions = ["very_good", "good", "new_build", "after_renovation", "before_renovation", "under_construction"]
    constructions = ["brick", "panel", "wooden", "mixed", "prefab"]
    ownerships = ["private", "cooperative", "municipal"]
    furnishings = ["furnished", "partially", "unfurnished"]
    energy_ratings = ["A", "B", "C", "D", "E", "F", "G"]
    all_amenities = ["balcony", "elevator", "parking", "cellar", "garden", "terrace", "loggia", "garage", "dishwasher", "washing_machine"]
    layouts_flat = ["1+kk", "1+1", "2+kk", "2+1", "3+kk", "3+1", "4+kk", "4+1", "5+kk"]
    layouts_house = ["3+1", "4+kk", "4+1", "5+kk", "5+1", "6+kk"]

    cities_data = {
        "Praha": {
            "count": 80, "region": "Hlavní město Praha",
            "districts": [
                ("Praha 1", 50.088, 14.421), ("Praha 2 - Vinohrady", 50.075, 14.438),
                ("Praha 3 - Žižkov", 50.083, 14.450), ("Praha 4 - Nusle", 50.060, 14.432),
                ("Praha 5 - Smíchov", 50.070, 14.400), ("Praha 6 - Dejvice", 50.100, 14.390),
                ("Praha 7 - Holešovice", 50.103, 14.430), ("Praha 8 - Karlín", 50.093, 14.448),
                ("Praha 9", 50.105, 14.470), ("Praha 10 - Vršovice", 50.068, 14.458),
                ("Letná", 50.099, 14.422), ("Břevnov", 50.085, 14.370),
            ],
            "streets": [
                "Vinohradská", "Žitná", "Korunní", "Seifertova", "Na Poříčí",
                "Jugoslávská", "Křížová", "Ječná", "Anglická", "Bělehradská",
                "Italská", "Londýnská", "Mánesova", "Slavíkova", "Husitská",
                "Milady Horákové", "Veletržní", "Janovského", "Komunardů", "Tusarova",
                "Přístavní", "Bubenská", "Na Pankráci", "Budějovická", "Táborská",
                "Nuselská", "Pod Vyšehradem", "Plzeňská", "Štefánikova", "Lidická"
            ]
        },
        "Brno": {
            "count": 40, "region": "Jihomoravský kraj",
            "districts": [
                ("Brno-střed", 49.196, 16.608), ("Brno-sever", 49.213, 16.600),
                ("Brno-Královo Pole", 49.210, 16.598), ("Brno-Žabovřesky", 49.204, 16.578),
                ("Brno-Líšeň", 49.201, 16.658), ("Brno-Bystrc", 49.225, 16.537),
            ],
            "streets": [
                "Masarykova", "Česká", "Veveří", "Lidická", "Kounicova",
                "Kotlářská", "Údolní", "Grohova", "Bayerova", "Hlinky"
            ]
        },
        "Ostrava": {
            "count": 20, "region": "Moravskoslezský kraj",
            "districts": [
                ("Ostrava-Poruba", 49.827, 18.166), ("Ostrava-Centrum", 49.836, 18.292),
                ("Ostrava-Mariánské Hory", 49.822, 18.261), ("Ostrava-Vítkovice", 49.814, 18.275),
            ],
            "streets": [
                "Nádražní", "Stodolní", "Poděbradova", "Českobratrská", "28. října",
                "Hlavní třída", "Opavská", "Sokolská", "Porážková", "Zengrova"
            ]
        },
        "Plzeň": {
            "count": 15, "region": "Plzeňský kraj",
            "districts": [
                ("Plzeň 1", 49.748, 13.379), ("Plzeň 2 - Slovany", 49.740, 13.390),
                ("Plzeň 3 - Bory", 49.742, 13.357),
            ],
            "streets": [
                "Americká", "Klatovská", "Sady Pětatřicátníků", "Prešovská",
                "Borská", "Husova", "Karlovarská", "Slovanská"
            ]
        },
        "Olomouc": {
            "count": 10, "region": "Olomoucký kraj",
            "districts": [
                ("Olomouc-město", 49.594, 17.251), ("Olomouc-Hodolany", 49.590, 17.270),
            ],
            "streets": [
                "Horní náměstí", "Dolní náměstí", "Třída Svobody", "Pavelčákova",
                "Riegrova", "Sokolská", "Palackého"
            ]
        },
        "Liberec": {
            "count": 10, "region": "Liberecký kraj",
            "districts": [
                ("Liberec 1", 50.767, 15.056), ("Liberec-Růžodol", 50.760, 15.040),
            ],
            "streets": [
                "Moskevská", "Pražská", "Masarykova", "Chrastavská",
                "Jablonecká", "Zhořelecká"
            ]
        },
        "České Budějovice": {
            "count": 10, "region": "Jihočeský kraj",
            "districts": [
                ("České Budějovice 1", 48.975, 14.474), ("České Budějovice 2", 48.980, 14.490),
            ],
            "streets": [
                "Lannova třída", "Nám. Přemysla Otakara II.", "Krajinská",
                "U Černé věže", "Piaristická", "Kněžská"
            ]
        },
        "Hradec Králové": {
            "count": 5, "region": "Královéhradecký kraj",
            "districts": [("Hradec Králové-město", 50.210, 15.832)],
            "streets": ["Gočárova třída", "Československé armády", "Dukelská třída"]
        },
        "Pardubice": {
            "count": 5, "region": "Pardubický kraj",
            "districts": [("Pardubice-město", 50.034, 15.769)],
            "streets": ["Třída Míru", "Palackého", "Smilova"]
        },
        "Zlín": {
            "count": 5, "region": "Zlínský kraj",
            "districts": [("Zlín-město", 49.226, 17.667)],
            "streets": ["Třída Tomáše Bati", "Zarámí", "Štefánikova"]
        },
    }

    czech_descriptions = {
        "flat": [
            "Prostorný byt v klidné lokalitě s výbornou dostupností do centra města. Byt je po kompletní rekonstrukci.",
            "Světlý byt s moderním vybavením a krásným výhledem. Součástí je balkon a sklepní kóje.",
            "Útulný byt v cihlové budově s vysokými stropy. Ideální pro mladé páry nebo jednotlivce.",
            "Kompletně zařízený byt v blízkosti metra. V ceně jsou zahrnuty poplatky za správu domu.",
            "Nově zrekonstruovaný byt s moderní kuchyňskou linkou a novými rozvody. Tiché prostředí.",
            "Byt s lodžií a panoramatickým výhledem na město. Vlastní parkovací stání v garáži.",
            "Reprezentativní byt ve vyhlédané lokalitě. Podlahové vytápění, vestavné skříně.",
            "Vzdušný mezonetový byt se dvěma koupelnami. Vhodný pro rodinu s dětmi."
        ],
        "house": [
            "Rodinný dům s velkou zahradou v klidné rezidenční čtvrti. Garáž pro dva vozy.",
            "Novostavba rodinného domu s moderní dispozicí a energeticky úsporným provozem.",
            "Řadový dům po rekonstrukci s terasou a zahradou. Blízko školy a obchodů.",
            "Samostatně stojící vila s bazénem a krásným pozemkem. Luxusní provedení."
        ],
        "commercial": [
            "Komerční prostory vhodné pro kancelář nebo obchod v centru města s vysokou návštěvností.",
            "Obchodní prostor v přízemí bytového domu na frekventované ulici. Vlastní sociální zařízení."
        ],
        "garage": [
            "Zděná garáž v uzavřeném dvoře. Elektřina, osvětlení.",
            "Podzemní garážové stání v novostavbě. Zabezpečeno kamerovým systémem."
        ],
        "land": [
            "Stavební parcela v obci s kompletní infrastrukturou. Klidné prostředí s výhledem.",
            "Pozemek pro výstavbu rodinného domu. IS na hranici pozemku."
        ],
        "cottage": [
            "Rekreační chalupa v malebné krajině. Ideální pro víkendové pobyty.",
            "Chata s vlastním pozemkem u lesa. Studna, elektřina, septik."
        ],
        "residential_building": [
            "Činžovní dům s 8 byty v centru města. Plně obsazeno, stabilní výnosy.",
            "Bytový dům po celkové rekonstrukci. Výtah, nová střecha, zateplení."
        ]
    }

    def weighted_choice(items_weights):
        items = [i[0] for i in items_weights]
        weights = [i[1] for i in items_weights]
        return random.choices(items, weights=weights, k=1)[0]

    listings = []
    listing_id = 0

    for city_name, city_info in cities_data.items():
        for i in range(city_info["count"]):
            listing_id += 1
            source = random.choice(sources)
            prop_type = weighted_choice(property_types_weights)
            trans_type = weighted_choice(transaction_types_weights)

            district = random.choice(city_info["districts"])
            district_name = district[0]
            base_lat = district[1] + random.uniform(-0.015, 0.015)
            base_lng = district[2] + random.uniform(-0.015, 0.015)

            street = random.choice(city_info["streets"])
            street_num = random.randint(1, 120)
            address = f"{street} {street_num}, {district_name}"

            if prop_type == "flat":
                layout = random.choice(layouts_flat)
                rooms = int(layout[0])
                size = random.randint(max(20, rooms * 15), min(150, rooms * 45 + 20))
                floor = random.randint(1, 8)
                total_floors = random.randint(floor, 10)
                if trans_type == "rent":
                    base_price = size * random.randint(200, 600)
                    if "Praha" in city_name:
                        base_price *= 1.5
                    elif city_name == "Brno":
                        base_price *= 1.2
                    price = round(base_price / 500) * 500
                else:
                    base_price = size * random.randint(50000, 150000)
                    if "Praha" in city_name:
                        base_price *= 1.8
                    elif city_name == "Brno":
                        base_price *= 1.3
                    price = round(base_price / 100000) * 100000
            elif prop_type == "house":
                layout = random.choice(layouts_house)
                rooms = int(layout[0])
                size = random.randint(80, 400)
                floor = None
                total_floors = random.randint(1, 3)
                if trans_type == "rent":
                    price = random.randint(15000, 80000)
                    price = round(price / 1000) * 1000
                else:
                    price = random.randint(2000000, 15000000)
                    price = round(price / 100000) * 100000
            elif prop_type == "commercial":
                layout = None
                size = random.randint(30, 500)
                floor = random.randint(0, 3)
                total_floors = random.randint(floor + 1, 6)
                if trans_type == "rent":
                    price = size * random.randint(200, 500)
                    price = round(price / 500) * 500
                else:
                    price = size * random.randint(40000, 100000)
                    price = round(price / 100000) * 100000
            elif prop_type == "garage":
                layout = None
                size = random.randint(12, 30)
                floor = random.choice([-1, -2, 0])
                total_floors = None
                trans_type = random.choice(["rent", "sale"])
                if trans_type == "rent":
                    price = random.randint(1500, 5000)
                    price = round(price / 500) * 500
                else:
                    price = random.randint(200000, 800000)
                    price = round(price / 50000) * 50000
            elif prop_type == "land":
                layout = None
                size = random.randint(300, 2000)
                floor = None
                total_floors = None
                trans_type = "sale"
                price = size * random.randint(800, 5000)
                price = round(price / 100000) * 100000
            elif prop_type == "cottage":
                layout = random.choice(["2+1", "3+kk", "3+1", "4+kk"])
                size = random.randint(40, 150)
                floor = None
                total_floors = random.randint(1, 2)
                if trans_type == "rent":
                    price = random.randint(5000, 20000)
                    price = round(price / 1000) * 1000
                else:
                    price = random.randint(800000, 5000000)
                    price = round(price / 100000) * 100000
            else:  # residential_building
                layout = None
                size = random.randint(200, 1000)
                floor = None
                total_floors = random.randint(3, 6)
                trans_type = "sale"
                price = random.randint(5000000, 30000000)
                price = round(price / 1000000) * 1000000

            type_names = {
                "flat": "bytu", "house": "domu", "commercial": "komerčního prostoru",
                "garage": "garáže", "land": "pozemku", "cottage": "chaty",
                "residential_building": "činžovního domu"
            }
            trans_names = {"rent": "Pronájem", "sale": "Prodej", "auction": "Aukce", "flatshare": "Spolubydlení"}

            type_name = type_names.get(prop_type, prop_type)
            trans_name = trans_names.get(trans_type, trans_type)

            if layout and size:
                title = f"{trans_name} {type_name} {layout}, {size} m²"
            elif size:
                title = f"{trans_name} {type_name}, {size} m²"
            else:
                title = f"{trans_name} {type_name}"

            cond = random.choice(conditions)
            constr = random.choice(constructions)
            own = random.choice(ownerships)
            furn = random.choice(furnishings)
            energy = random.choice(energy_ratings)

            if prop_type == "garage":
                selected_amenities = ["parking"]
            elif prop_type == "commercial":
                commercial_amenities = ["elevator", "parking", "garage"]
                num_amenities = random.randint(0, 2)
                selected_amenities = random.sample(commercial_amenities, num_amenities) if num_amenities > 0 else []
            elif prop_type == "land":
                selected_amenities = []
            else:
                num_amenities = random.randint(1, 6)
                selected_amenities = random.sample(all_amenities, min(num_amenities, len(all_amenities)))

            descriptions = czech_descriptions.get(prop_type, czech_descriptions["flat"])
            description = random.choice(descriptions)

            days_ago = random.randint(0, 60)
            hours_ago = random.randint(0, 23)
            listed_at = (datetime.now() - timedelta(days=days_ago, hours=hours_ago)).strftime("%Y-%m-%d %H:%M:%S")

            seed_val = f"{listing_id}_{city_name}_{i}"
            num_images = random.randint(3, 8)
            image_urls = [f"https://picsum.photos/seed/{hashlib.md5((seed_val + str(j)).encode()).hexdigest()[:8]}/400/300" for j in range(num_images)]
            thumbnail_url = image_urls[0]

            price_note = None
            if trans_type == "rent" and prop_type in ("flat", "house"):
                if random.random() > 0.4:
                    services = random.choice([2000, 3000, 3500, 4000, 5000, 6000])
                    price_note = f"+ {services:,} Kč služby".replace(",", " ")

            source_urls = {
                "sreality": f"https://www.sreality.cz/detail/{trans_type}/{prop_type}/{listing_id}",
                "bezrealitky": f"https://www.bezrealitky.cz/nemovitosti-byty-domy/{listing_id}",
                "ulovdomov": f"https://www.ulovdomov.cz/fe/nabidka/{listing_id}"
            }

            ext_id = f"{source}_{listing_id}_{hashlib.md5(seed_val.encode()).hexdigest()[:6]}"

            listings.append((
                ext_id, source, prop_type, trans_type, title, description,
                price, "CZK", price_note, address, city_name, district_name,
                city_info["region"], base_lat, base_lng, size, layout,
                floor, total_floors, cond, constr, own, furn, energy,
                ",".join(selected_amenities), json.dumps(image_urls),
                thumbnail_url, source_urls[source], listed_at, 1
            ))

    db.executemany("""
        INSERT INTO listings (
            external_id, source, property_type, transaction_type, title, description,
            price, currency, price_note, address, city, district,
            region, latitude, longitude, size_m2, layout,
            floor, total_floors, condition, construction, ownership, furnishing, energy_rating,
            amenities, image_urls, thumbnail_url, source_url, listed_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, listings)
    db.commit()

    return {"message": f"Seeded {len(listings)} listings", "seeded": True, "count": len(listings)}


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
# Routes — Seed
# ============================================

@app.route("/api/seed", methods=["GET"])
def api_seed():
    db = get_db()
    init_db(db)
    result = do_seed(db)
    status = 200 if result.get("seeded") else 200
    return jsonify(result), status


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

    # Seed on startup if DB is empty
    db = get_db()
    init_db(db)
    total = db.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
    if total == 0:
        print("Database is empty — seeding demo data...")
        result = do_seed(db)
        print(f"  {result['message']}")
    db.close()

    print("Starting Flat Finder CZ API server on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False)
