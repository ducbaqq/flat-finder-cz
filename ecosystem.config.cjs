/**
 * PM2 process definitions — Flat Finder CZ.
 *
 * SOURCE OF TRUTH. The droplet's copy must be replaced after major changes.
 * Until 2026-04-26 this file lived only on the droplet; it now lives in git
 * so future changes can be code-reviewed and deployed via `git pull`.
 *
 * --------------------------------------------------------------------------
 * Deploy procedure
 * --------------------------------------------------------------------------
 * Additive changes (e.g. new process, new env var):
 *   git pull
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
 * Process inventory (matches running droplet config as of 2026-04-26)
 * --------------------------------------------------------------------------
 *   api       — Hono server on :4000, runs from compiled dist (heap 2048MB
 *               after the 2026-04-11 droplet upsize 2GB→4GB Premium AMD).
 *               Requires `npm run build -w apps/api` before pm2 restart.
 *   web       — Next.js production server on :3000, direct next-binary
 *               invocation (avoids npm wrapper overhead).
 *               Requires `npm run build -w apps/web` before pm2 restart.
 *   scraper   — npx-launched tsx watch loop (5-min interval, no dashboard).
 *   notifier  — Hlídač nemovitostí saved-search notifier (5-min loop).
 */

module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/root/flat-finder-cz",
      script: "apps/api/dist/index.js",
      node_args: "--max-old-space-size=2048",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
    },
    {
      name: "web",
      cwd: "/root/flat-finder-cz/apps/web",
      script: "node_modules/.bin/next",
      args: "start --port 3000 --hostname 0.0.0.0",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "scraper",
      cwd: "/root/flat-finder-cz",
      script: "/usr/bin/npx",
      args: "tsx apps/scraper/src/index.ts --watch --no-dashboard",
      // Scraper holds 80–150 MB during incremental cycles; 512 MB is
      // generous headroom. If we trip this, something has leaked.
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "notifier",
      cwd: "/root/flat-finder-cz",
      script: "/usr/bin/npx",
      // Locked product decision (2026-04-26): 5-minute notification loop.
      args: "tsx apps/notifier/src/index.ts --loop --interval 300",
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
