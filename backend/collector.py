#!/usr/bin/env python3
"""
Flat Finder CZ — Listing Collector
Scaffold for scraping sreality.cz, bezrealitky.cz, and ulovdomov.cz.

Run every 5 minutes via cron or scheduler to fetch new listings.
"""

import sqlite3
import json
import time
import hashlib
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "../data/flat_finder.db"

# ============================================
# Email Configuration (set via environment)
# ============================================
import os
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@flatfindercz.com")
APP_URL = os.getenv("APP_URL", "http://localhost:8080")


def get_db():
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


# ============================================
# Collectors — implement these
# ============================================

def collect_sreality():
    """
    Collect listings from sreality.cz.
    
    Sreality has a public API at:
    https://www.sreality.cz/api/cs/v2/estates
    
    Parameters:
    - category_main_cb: 1=flat, 2=house, 3=land, 4=commercial, 5=other
    - category_type_cb: 1=sale, 2=rent
    - per_page: results per page
    - page: page number
    
    Returns list of listing dicts.
    """
    listings = []
    # TODO: Implement sreality.cz collector
    # 1. Paginate through API results
    # 2. Parse each listing into standard format
    # 3. Extract images, coordinates, details
    return listings


def collect_bezrealitky():
    """
    Collect listings from bezrealitky.cz.
    
    Bezrealitky uses a GraphQL API at:
    https://www.bezrealitky.cz/api/graphql
    
    Returns list of listing dicts.
    """
    listings = []
    # TODO: Implement bezrealitky.cz collector
    return listings


def collect_ulovdomov():
    """
    Collect listings from ulovdomov.cz.
    
    Ulov Domov has an API accessible at:
    https://www.ulovdomov.cz/fe/api
    
    Returns list of listing dicts.
    """
    listings = []
    # TODO: Implement ulovdomov.cz collector
    return listings


def normalize_listing(raw, source):
    """
    Normalize a raw listing dict into the standard database format.
    
    Expected output keys:
    external_id, source, property_type, transaction_type, title, description,
    price, currency, price_note, address, city, district, region,
    latitude, longitude, size_m2, layout, floor, total_floors,
    condition, construction, ownership, furnishing, energy_rating,
    amenities, image_urls, thumbnail_url, source_url, listed_at
    """
    # TODO: Map source-specific fields to standard schema
    return {
        "external_id": f"{source}_{raw.get('id', '')}",
        "source": source,
        # ... map all fields
    }


# ============================================
# Database Operations
# ============================================

def insert_listings(db, listings):
    """Insert new listings, skip duplicates by external_id."""
    new_count = 0
    new_listings = []
    
    for listing in listings:
        try:
            db.execute("""
                INSERT OR IGNORE INTO listings (
                    external_id, source, property_type, transaction_type, 
                    title, description, price, currency, price_note,
                    address, city, district, region, latitude, longitude,
                    size_m2, layout, floor, total_floors,
                    condition, construction, ownership, furnishing, energy_rating,
                    amenities, image_urls, thumbnail_url, source_url, listed_at
                ) VALUES (
                    :external_id, :source, :property_type, :transaction_type,
                    :title, :description, :price, :currency, :price_note,
                    :address, :city, :district, :region, :latitude, :longitude,
                    :size_m2, :layout, :floor, :total_floors,
                    :condition, :construction, :ownership, :furnishing, :energy_rating,
                    :amenities, :image_urls, :thumbnail_url, :source_url, :listed_at
                )
            """, listing)
            
            if db.execute("SELECT changes()").fetchone()[0] > 0:
                new_count += 1
                new_listings.append(listing)
        except Exception as e:
            print(f"Error inserting listing {listing.get('external_id')}: {e}")
    
    db.commit()
    return new_count, new_listings


# ============================================
# Watchdog Matching
# ============================================

def check_watchdogs(db, new_listings):
    """Check new listings against active watchdogs and send notifications."""
    watchdogs = db.execute(
        "SELECT * FROM watchdogs WHERE active = 1"
    ).fetchall()
    
    for watchdog in watchdogs:
        filters = json.loads(watchdog["filters"])
        matching = [l for l in new_listings if matches_filters(l, filters)]
        
        if matching:
            send_watchdog_email(watchdog, matching)
            db.execute(
                "UPDATE watchdogs SET last_notified_at = ? WHERE id = ?",
                [datetime.now().isoformat(), watchdog["id"]]
            )
    
    db.commit()


def matches_filters(listing, filters):
    """Check if a listing matches watchdog filter criteria."""
    if filters.get("transaction_type") and listing.get("transaction_type") != filters["transaction_type"]:
        return False
    
    if filters.get("property_type"):
        types = filters["property_type"].split(",")
        if listing.get("property_type") not in types:
            return False
    
    if filters.get("location"):
        loc = filters["location"].lower()
        fields = [listing.get("city", ""), listing.get("district", ""), 
                  listing.get("region", ""), listing.get("address", "")]
        if not any(loc in (f or "").lower() for f in fields):
            return False
    
    if filters.get("price_min"):
        if (listing.get("price") or 0) < float(filters["price_min"]):
            return False
    
    if filters.get("price_max"):
        if (listing.get("price") or float("inf")) > float(filters["price_max"]):
            return False
    
    if filters.get("size_min"):
        if (listing.get("size_m2") or 0) < float(filters["size_min"]):
            return False
    
    if filters.get("size_max"):
        if (listing.get("size_m2") or float("inf")) > float(filters["size_max"]):
            return False
    
    if filters.get("layout"):
        layouts = filters["layout"].split(",")
        if listing.get("layout") not in layouts:
            return False
    
    if filters.get("source"):
        sources = filters["source"].split(",")
        if listing.get("source") not in sources:
            return False
    
    return True


# ============================================
# Email Notifications
# ============================================

def send_watchdog_email(watchdog, listings):
    """Send email notification for matching listings."""
    email = watchdog["email"]
    label = watchdog["label"] or f"Hlídací pes #{watchdog['id']}"
    
    html = build_email_html(label, listings)
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🏠 Flat Finder CZ — {len(listings)} nových nabídek ({label})"
    msg["From"] = FROM_EMAIL
    msg["To"] = email
    msg.attach(MIMEText(html, "html"))
    
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(FROM_EMAIL, email, msg.as_string())
        print(f"Email sent to {email} with {len(listings)} listings")
    except Exception as e:
        print(f"Failed to send email to {email}: {e}")


def build_email_html(label, listings):
    """Build the HTML email body matching the app's visual language."""
    listing_cards = ""
    for l in listings[:5]:  # Limit to 5 per email
        price = f"{int(l.get('price', 0)):,}".replace(",", " ")
        listing_cards += f"""
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td width="120" style="vertical-align: top;">
                  <img src="{l.get('thumbnail_url', '')}" alt="" 
                    width="120" height="80" 
                    style="border-radius: 8px; object-fit: cover; display: block;">
                </td>
                <td style="padding-left: 16px; vertical-align: top;">
                  <div style="font-weight: 600; font-size: 14px; color: #1a1a1a; margin-bottom: 4px;">
                    {l.get('title', '—')}
                  </div>
                  <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
                    {l.get('address', '')} {l.get('city', '')}
                  </div>
                  <div style="font-weight: 700; font-size: 16px; color: #0D9488;">
                    {price} CZK{''/měs.' if l.get('transaction_type') == 'rent' else ''}
                  </div>
                  <div style="margin-top: 8px;">
                    <a href="{APP_URL}#listing={l.get('external_id', '')}" 
                      style="display: inline-block; padding: 6px 16px; background: #0D9488; color: #fff; 
                        text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 600;">
                      Zobrazit detail →
                    </a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """
    
    more_text = ""
    if len(listings) > 5:
        more_text = f"""
        <tr>
          <td style="padding: 16px 0; text-align: center;">
            <span style="color: #6b7280; font-size: 13px;">
              ...a dalších {len(listings) - 5} nabídek
            </span>
          </td>
        </tr>
        """
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f3f4f6;">
        <tr>
          <td align="center" style="padding: 24px 16px;">
            <table cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px;">
              <!-- Header -->
              <tr>
                <td style="text-align: center; padding-bottom: 24px;">
                  <span style="font-size: 20px; font-weight: 700; color: #1a1a1a;">
                    Flat Finder <span style="color: #0D9488;">CZ</span>
                  </span>
                </td>
              </tr>
              <!-- Card -->
              <tr>
                <td style="background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <div style="font-size: 16px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px;">
                    Nové nabídky pro: {label}
                  </div>
                  <div style="font-size: 13px; color: #6b7280; margin-bottom: 20px;">
                    Nalezeno {len(listings)} nových nemovitostí odpovídajících vašim kritériím.
                  </div>
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    {listing_cards}
                    {more_text}
                  </table>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="text-align: center; padding-top: 20px; font-size: 11px; color: #9ca3af;">
                  Tento e-mail vám byl zaslán z Flat Finder CZ.<br>
                  Pro zrušení hlídacího psa navštivte aplikaci.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """


# ============================================
# Main
# ============================================

def run():
    """Run a single collection cycle."""
    print(f"[{datetime.now().isoformat()}] Starting collection cycle...")
    
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = get_db()
    
    all_new = []
    
    # Collect from all sources
    for name, collector in [
        ("sreality", collect_sreality),
        ("bezrealitky", collect_bezrealitky),
        ("ulovdomov", collect_ulovdomov),
    ]:
        try:
            print(f"  Collecting from {name}...")
            raw_listings = collector()
            normalized = [normalize_listing(l, name) for l in raw_listings]
            new_count, new_listings = insert_listings(db, normalized)
            all_new.extend(new_listings)
            print(f"  {name}: {len(raw_listings)} fetched, {new_count} new")
        except Exception as e:
            print(f"  {name}: ERROR — {e}")
    
    # Check watchdogs for new listings
    if all_new:
        print(f"  Checking watchdogs for {len(all_new)} new listings...")
        check_watchdogs(db, all_new)
    
    db.close()
    print(f"  Done. Total new: {len(all_new)}")


if __name__ == "__main__":
    run()
