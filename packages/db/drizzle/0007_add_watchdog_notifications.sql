-- Watchdog notification audit + email canonicalization.
--
-- Adds a per-(canonical_email, cluster_key) audit row written ONLY after a
-- successful Brevo 2xx. The matcher anti-joins against this table so a user
-- never receives the same real-world property twice — across listing IDs,
-- across portals, across cluster reshuffles.
--
-- Also adds `email_canonical` to watchdogs to enforce one-active-watchdog
-- per real human (Gmail dot/+ tricks normalized away). Unique index is
-- partial (active = true) so deactivated rows can keep their canonical
-- without blocking re-creation.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; psql -f runs
-- each statement implicitly. Do not wrap in BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS "watchdog_notifications" (
  "email_canonical" text NOT NULL,
  "cluster_key"     text NOT NULL,
  "sent_at"         timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("email_canonical", "cluster_key")
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_wn_sent_at"
  ON "watchdog_notifications" ("sent_at");

ALTER TABLE "watchdogs" ADD COLUMN IF NOT EXISTS "email_canonical" text;

-- Backfill: mirror the JS canonicalizer in pure SQL.
--   1. lower(trim(email))
--   2. strip everything from '+' onward in the local part
--   3. for gmail.com / googlemail.com: strip dots from local part, unify
--      domain to gmail.com
--   4. otherwise leave dots intact
-- ASCII-only inputs are byte-identical to the JS path. Edge-case unicode
-- locals (rare) may drift slightly; the JS canonicalizer is the going-
-- forward source of truth and the partial unique index is computed off
-- whatever this backfill produces, so consistency post-deploy is fine.
UPDATE "watchdogs"
SET "email_canonical" = (
  CASE
    WHEN split_part(lower(trim("email")), '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(lower(trim("email")), '@', 1), '+', 1), '.', '')
        || '@gmail.com'
    ELSE split_part(split_part(lower(trim("email")), '@', 1), '+', 1)
        || '@'
        || split_part(lower(trim("email")), '@', 2)
  END
)
WHERE "email_canonical" IS NULL;

ALTER TABLE "watchdogs" ALTER COLUMN "email_canonical" SET NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_watchdogs_email_canonical_active"
  ON "watchdogs" ("email_canonical")
  WHERE "active" = true;
