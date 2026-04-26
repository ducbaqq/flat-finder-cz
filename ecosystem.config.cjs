/**
 * PM2 process definitions — Flat Finder CZ.
 *
 * SOURCE OF TRUTH. The droplet's copy must be replaced after major changes.
 * Until 2026-04-26 this file lived only on the droplet; it now lives in git
 * so future changes can be code-reviewed and deployed via `scp`.
 *
 * --------------------------------------------------------------------------
 * Deploy procedure
 * --------------------------------------------------------------------------
 *   scp ecosystem.config.cjs root@167.172.176.70:/root/flat-finder-cz/
 *
 * Additive changes (e.g. new process, new env var):
 *   pm2 reload ecosystem.config.cjs
 *   pm2 save
 *
 * `node_args` / `args` / `interpreter` changes on an EXISTING process:
 *   pm2 delete <name>
 *   pm2 start ecosystem.config.cjs --only <name>
 *   pm2 save
 *   (pm2 restart / reload do NOT pick up node_args changes — see the
 *    2026-04-11 entry in droplet-deployment.md.)
 *
 * One-time first deploy of the notifier process:
 *   pm2 start ecosystem.config.cjs --only notifier
 *   pm2 save
 *
 * --------------------------------------------------------------------------
 * Process inventory
 * --------------------------------------------------------------------------
 *   api       — Hono server on :4000 (heap bumped to 2048MB on 2026-04-11
 *               after the droplet upsize from 2GB → 4GB Premium AMD)
 *   web       — Next.js production server on :3000
 *   scraper   — tsx watch loop (5-min interval, --no-dashboard)
 *   notifier  — Hlídač nemovitostí saved-search notifier (5-min loop)
 */

module.exports = {
  apps: [
    {
      name: "api",
      script: "apps/api/src/index.ts",
      interpreter: "tsx",
      cwd: "/root/flat-finder-cz",
      node_args: "--max-old-space-size=2048",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "4000",
      },
    },
    {
      name: "web",
      script: "npm",
      args: "run start -w apps/web",
      cwd: "/root/flat-finder-cz",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "scraper",
      script: "apps/scraper/src/index.ts",
      interpreter: "tsx",
      args: "--watch --no-dashboard",
      cwd: "/root/flat-finder-cz",
      autorestart: true,
      // Scraper holds 80–150 MB during incremental cycles; 512 MB is
      // generous headroom. If we trip this, something has leaked.
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "notifier",
      script: "apps/notifier/src/index.ts",
      interpreter: "tsx",
      // Locked product decision (2026-04-26): 5-minute notification loop.
      args: "--loop --interval 300",
      cwd: "/root/flat-finder-cz",
      autorestart: true,
      max_memory_restart: "300M",
      // Brevo POSTs can take a few seconds; give the in-flight request up
      // to 30s to drain on `pm2 stop notifier` before SIGKILL fires.
      kill_timeout: 30_000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
