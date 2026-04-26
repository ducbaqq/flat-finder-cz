-- Soft-delete column for watchdogs.
--
-- "Delete" from the user's perspective means: no more emails, no longer
-- visible in their list, the row stays in the DB. Distinct from "Pause"
-- (active=false but deleted_at IS NULL — still visible in the list and
-- re-activatable).
--
-- The notifier excludes (deleted_at IS NOT NULL) rows; the API list
-- endpoint excludes them; the partial unique index on email_canonical
-- already gates on `active = true`, so a soft-deleted row's
-- email_canonical is free for re-creation.

ALTER TABLE "watchdogs" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
