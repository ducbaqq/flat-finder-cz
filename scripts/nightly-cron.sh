#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Nightly orchestration for Flat Finder CZ.
#
# Install on droplet (replaces the inline crontab line installed 2026-04-20):
#
#   CRON_TZ=Europe/Prague
#   0 0 * * * /root/flat-finder-cz/scripts/nightly-cron.sh >> /var/log/scraper-nightly.log 2>&1
#
# (CRON_TZ should already be set at the top of root's crontab on the droplet
# per the 2026-04-20 entry in droplet-deployment.md. If not, add it.)
#
# Steps:
#   1. Stop the long-running PM2 processes that hold DB connections / write
#      to the same tables we're about to mass-mutate (scraper + notifier).
#   2. Run --full scrape, --dedupe, warm-cache, audit-key-rewrite.
#   3. Restart scraper + notifier.
#
# Failure handling:
#   - No global `set -e`. If --full or --dedupe fails halfway through, we
#     STILL want subsequent steps and the final pm2 starts to run. Each
#     heavy step is separated by `;` so one failure doesn't block the rest.
#   - The pm2 restarts run inside a `trap … EXIT` so they fire no matter
#     how the script exits — error, SIGINT during a manual run, OOM, kill.
#     Without the trap, an interruption mid-run would leave the droplet
#     with both scraper and notifier offline until manual intervention.
#   - The SQL rewrite step uses `set -e` inside a subshell so it bails on
#     SQL errors but doesn't taint the parent shell's exit status.
# ----------------------------------------------------------------------------

cd /root/flat-finder-cz || exit 1

restart_processes() {
  echo "[$(date -Is)] Restoring pm2 processes (scraper, notifier)..."
  pm2 start scraper
  pm2 start notifier
}
trap restart_processes EXIT

echo "[$(date -Is)] Nightly cron starting"

# 1. Pause heavy DB writers. `;` so a failed stop (already-stopped process)
#    doesn't abort the rest of the run.
pm2 stop scraper; pm2 stop notifier

# 2. Heavy-lift orchestration. Best-effort: each step independent, failures
#    log but don't gate downstream steps. Matches the pattern locked in on
#    2026-04-20 and the initial-scrape.sh approach from 2026-04-22.
/usr/bin/npm run scraper -- --full
/usr/bin/npm run scraper -- --dedupe
/root/flat-finder-cz/node_modules/.bin/tsx /root/flat-finder-cz/scripts/warm-cache.ts

# 3. Rewrite stale singleton audit keys to clustered keys (post-dedupe).
#    Subshell with set -e so the SQL step exits cleanly on failure but the
#    overall script keeps going to the trap. Idempotent — safe to retry.
(
  set -e
  /root/flat-finder-cz/node_modules/.bin/tsx \
    /root/flat-finder-cz/scripts/rewrite-singleton-audit-keys.ts
) || echo "[$(date -Is)] WARN: audit-key-rewrite step failed; pm2 will still resume"

echo "[$(date -Is)] Nightly cron orchestration done"
# trap fires here -> restart_processes
