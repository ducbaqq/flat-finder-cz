CREATE INDEX "idx_listings_active_listed" ON "listings" USING btree ("is_active","listed_at");--> statement-breakpoint
CREATE INDEX "idx_listings_filtered_geo" ON "listings" USING btree ("is_active","property_type","transaction_type","latitude","longitude");--> statement-breakpoint
CREATE INDEX "idx_listings_city_lower" ON "listings" USING btree ("city");--> statement-breakpoint
CREATE INDEX "idx_listings_district" ON "listings" USING btree ("district");