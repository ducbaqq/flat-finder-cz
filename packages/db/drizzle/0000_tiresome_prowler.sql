CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"source" text NOT NULL,
	"property_type" text NOT NULL,
	"transaction_type" text NOT NULL,
	"title" text,
	"description" text,
	"price" double precision,
	"currency" text DEFAULT 'CZK',
	"price_note" text,
	"address" text,
	"city" text,
	"district" text,
	"region" text,
	"latitude" double precision,
	"longitude" double precision,
	"size_m2" double precision,
	"layout" text,
	"floor" integer,
	"total_floors" integer,
	"condition" text,
	"construction" text,
	"ownership" text,
	"furnishing" text,
	"energy_rating" text,
	"amenities" text,
	"image_urls" jsonb DEFAULT '[]'::jsonb,
	"thumbnail_url" text,
	"source_url" text,
	"listed_at" timestamp,
	"scraped_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true,
	"deactivated_at" timestamp,
	"seller_name" text,
	"seller_phone" text,
	"seller_email" text,
	"seller_company" text,
	"additional_params" jsonb,
	CONSTRAINT "listings_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "scraper_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp,
	"new_count" integer DEFAULT 0,
	"updated_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"deactivated_count" integer DEFAULT 0,
	"elapsed_ms" integer,
	"status" text DEFAULT 'running',
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "watchdogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"filters" jsonb NOT NULL,
	"label" text,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"last_notified_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "idx_listings_city" ON "listings" USING btree ("city");--> statement-breakpoint
CREATE INDEX "idx_listings_price" ON "listings" USING btree ("price");--> statement-breakpoint
CREATE INDEX "idx_listings_source" ON "listings" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_listings_property_type" ON "listings" USING btree ("property_type");--> statement-breakpoint
CREATE INDEX "idx_listings_transaction_type" ON "listings" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "idx_listings_is_active" ON "listings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_listings_external_id" ON "listings" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_listings_geo" ON "listings" USING btree ("is_active","latitude","longitude");--> statement-breakpoint
CREATE INDEX "idx_watchdogs_email" ON "watchdogs" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_watchdogs_active" ON "watchdogs" USING btree ("active");