/**
 * One-time migration script: SQLite → PostgreSQL
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-pg.ts [--sqlite-path ./data/flat_finder.db]
 *
 * Prerequisites:
 *   - PostgreSQL running (docker-compose up -d)
 *   - Tables created (npm run db:push)
 *   - npm install better-sqlite3 (one-time dep)
 */

import { config } from "dotenv";
config();

import postgres from "postgres";

// We use dynamic import for better-sqlite3 since it's an optional dep
async function main() {
  const sqlitePath =
    process.argv.find((a) => a.startsWith("--sqlite-path="))?.split("=")[1] ??
    process.argv[process.argv.indexOf("--sqlite-path") + 1] ??
    "./data/flat_finder.db";

  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://flat_finder:flat_finder_dev@localhost:5432/flat_finder";

  console.log(`Migrating from SQLite: ${sqlitePath}`);
  console.log(`To PostgreSQL: ${databaseUrl.replace(/:[^@]+@/, ":***@")}`);

  // Dynamic import — user must install better-sqlite3 for migration
  let Database: any;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    console.error(
      "Please install better-sqlite3 first: npm install -D better-sqlite3 @types/better-sqlite3",
    );
    process.exit(1);
  }

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pg = postgres(databaseUrl);

  // Count total
  const { count: totalCount } = sqlite
    .prepare("SELECT COUNT(*) as count FROM listings")
    .get() as { count: number };
  console.log(`Found ${totalCount} listings in SQLite`);

  // Count watchdogs
  let watchdogCount = 0;
  try {
    const wResult = sqlite
      .prepare("SELECT COUNT(*) as count FROM watchdogs")
      .get() as { count: number };
    watchdogCount = wResult.count;
    console.log(`Found ${watchdogCount} watchdogs in SQLite`);
  } catch {
    console.log("No watchdogs table found in SQLite");
  }

  // Migrate listings in batches
  const BATCH_SIZE = 1000;
  let migrated = 0;
  let errors = 0;

  const columns = [
    "external_id", "source", "property_type", "transaction_type",
    "title", "description", "price", "currency", "price_note",
    "address", "city", "district", "region",
    "latitude", "longitude", "size_m2", "layout",
    "floor", "total_floors", "condition", "construction", "ownership",
    "furnishing", "energy_rating", "amenities",
    "image_urls", "thumbnail_url", "source_url",
    "listed_at", "scraped_at", "created_at",
    "is_active", "deactivated_at",
    "seller_name", "seller_phone", "seller_email", "seller_company",
    "additional_params",
  ];

  const stmt = sqlite.prepare(
    `SELECT ${columns.join(", ")} FROM listings LIMIT ? OFFSET ?`,
  );

  for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
    const rows = stmt.all(BATCH_SIZE, offset) as Record<string, unknown>[];

    const pgRows = rows.map((row) => {
      // Parse image_urls from JSON string to jsonb
      let imageUrls: string[] = [];
      if (row.image_urls && typeof row.image_urls === "string") {
        try {
          imageUrls = JSON.parse(row.image_urls);
        } catch {
          imageUrls = [];
        }
      }

      // Parse additional_params from JSON string to jsonb
      let additionalParams: Record<string, unknown> | null = null;
      if (row.additional_params && typeof row.additional_params === "string") {
        try {
          additionalParams = JSON.parse(row.additional_params);
        } catch {
          additionalParams = null;
        }
      }

      return {
        external_id: row.external_id as string,
        source: row.source as string,
        property_type: row.property_type as string,
        transaction_type: row.transaction_type as string,
        title: row.title as string | null,
        description: row.description as string | null,
        price: row.price as number | null,
        currency: (row.currency as string) ?? "CZK",
        price_note: row.price_note as string | null,
        address: row.address as string | null,
        city: row.city as string | null,
        district: row.district as string | null,
        region: row.region as string | null,
        latitude: row.latitude as number | null,
        longitude: row.longitude as number | null,
        size_m2: row.size_m2 as number | null,
        layout: row.layout as string | null,
        floor: row.floor as number | null,
        total_floors: row.total_floors as number | null,
        condition: row.condition as string | null,
        construction: row.construction as string | null,
        ownership: row.ownership as string | null,
        furnishing: row.furnishing as string | null,
        energy_rating: row.energy_rating as string | null,
        amenities: row.amenities as string | null,
        image_urls: JSON.stringify(imageUrls),
        thumbnail_url: row.thumbnail_url as string | null,
        source_url: row.source_url as string | null,
        listed_at: row.listed_at as string | null,
        scraped_at: row.scraped_at as string | null,
        created_at: row.created_at as string | null,
        is_active: row.is_active === 1 || row.is_active === true,
        deactivated_at: row.deactivated_at as string | null,
        seller_name: row.seller_name as string | null,
        seller_phone: row.seller_phone as string | null,
        seller_email: row.seller_email as string | null,
        seller_company: row.seller_company as string | null,
        additional_params: additionalParams
          ? JSON.stringify(additionalParams)
          : null,
      };
    });

    try {
      // Use ON CONFLICT to handle duplicates
      await pg`
        INSERT INTO listings ${pg(
          pgRows,
          "external_id", "source", "property_type", "transaction_type",
          "title", "description", "price", "currency", "price_note",
          "address", "city", "district", "region",
          "latitude", "longitude", "size_m2", "layout",
          "floor", "total_floors", "condition", "construction", "ownership",
          "furnishing", "energy_rating", "amenities",
          "image_urls", "thumbnail_url", "source_url",
          "listed_at", "scraped_at", "created_at",
          "is_active", "deactivated_at",
          "seller_name", "seller_phone", "seller_email", "seller_company",
          "additional_params",
        )}
        ON CONFLICT (external_id) DO NOTHING
      `;
      migrated += pgRows.length;
    } catch (err) {
      console.error(`Error in batch at offset ${offset}:`, err);
      errors += pgRows.length;
    }

    process.stdout.write(
      `\r  Listings: ${migrated}/${totalCount} migrated, ${errors} errors`,
    );
  }
  console.log();

  // Migrate watchdogs
  if (watchdogCount > 0) {
    const wStmt = sqlite.prepare(
      "SELECT email, filters, label, active, created_at, last_notified_at FROM watchdogs",
    );
    const wRows = wStmt.all() as Record<string, unknown>[];

    const pgWatchdogs = wRows.map((row) => {
      let filters: Record<string, unknown> = {};
      if (row.filters && typeof row.filters === "string") {
        try {
          filters = JSON.parse(row.filters);
        } catch {
          filters = {};
        }
      }
      return {
        email: row.email as string,
        filters: JSON.stringify(filters),
        label: row.label as string | null,
        active: row.active === 1 || row.active === true,
        created_at: row.created_at as string | null,
        last_notified_at: row.last_notified_at as string | null,
      };
    });

    try {
      await pg`INSERT INTO watchdogs ${pg(
        pgWatchdogs,
        "email", "filters", "label", "active", "created_at", "last_notified_at",
      )}`;
      console.log(`  Watchdogs: ${pgWatchdogs.length} migrated`);
    } catch (err) {
      console.error("Error migrating watchdogs:", err);
    }
  }

  // Summary
  const pgCount = await pg`SELECT COUNT(*) as count FROM listings`;
  console.log(`\nMigration complete!`);
  console.log(`  PostgreSQL now has ${pgCount[0].count} listings`);

  sqlite.close();
  await pg.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
