/**
 * Check replication lag, WAL stats, bg writer + checkpointer activity.
 * Managed PG providers run a replica for HA; a mass UPDATE can swamp it
 * and pin the primary's CPU on WAL streaming until it catches up.
 *
 * Usage: npx tsx scripts/diag-replication.ts
 */
import { config } from "dotenv";
config();

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function connect() {
  const username = process.env.DB_USERNAME ?? "flat_finder";
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const database = process.env.DB_DATABASE ?? "reality-app";
  const url = `postgres://${username}:${password}@${host}:${port}/${database}`;

  const caPath = path.resolve(process.cwd(), "certs/ca-certificate.crt");
  const ssl =
    process.env.DB_SSLMODE === "disable"
      ? false
      : fs.existsSync(caPath)
        ? { ca: fs.readFileSync(caPath, "utf-8"), rejectUnauthorized: true }
        : { rejectUnauthorized: false };

  return postgres(url, { ssl, max: 1, connect_timeout: 15 });
}

/**
 * Returns true if the error is a Postgres "this column or table does not
 * exist" schema-mismatch. We expect these when probing catalog views that
 * changed between PG versions (pg_stat_wal, pg_stat_bgwriter) — but we do
 * NOT want to swallow transient issues like auth failures or dropped
 * connections, which would just hide real problems during triage.
 *
 * SQLSTATE codes:
 *   42703 = undefined_column
 *   42P01 = undefined_table
 */
function isSchemaMismatch(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42703" || code === "42P01";
}

async function main() {
  const sql = connect();
  try {
    console.log("=== pg_stat_replication (lag to replicas) ===");
    const rep = await sql<
      Array<{
        application_name: string;
        state: string;
        sync_state: string;
        write_lag: string | null;
        flush_lag: string | null;
        replay_lag: string | null;
      }>
    >`
      SELECT application_name, state, sync_state,
        write_lag::text, flush_lag::text, replay_lag::text
      FROM pg_stat_replication
    `;
    if (rep.length === 0) {
      console.log("  (none visible — DO managed replication may be hidden from non-superusers)");
    } else {
      for (const r of rep) {
        console.log(`  ${r.application_name} state=${r.state} sync=${r.sync_state}`);
        console.log(`    write_lag=${r.write_lag} flush_lag=${r.flush_lag} replay_lag=${r.replay_lag}`);
      }
    }

    console.log("\n=== WAL stats ===");
    try {
      const [wal] = await sql<
        Array<{
          wal_records: string;
          wal_bytes: string;
          wal_buffers_full: string;
          wal_write: string;
          wal_sync: string;
          stats_reset: string;
        }>
      >`
        SELECT
          wal_records::text, wal_bytes::text, wal_buffers_full::text,
          wal_write::text, wal_sync::text, stats_reset::text
        FROM pg_stat_wal
      `;
      console.log(`  wal_records:      ${wal.wal_records}`);
      console.log(`  wal_bytes:        ${wal.wal_bytes}`);
      console.log(`  wal_buffers_full: ${wal.wal_buffers_full}  ← non-zero means WAL buffers are undersized`);
      console.log(`  wal_writes:       ${wal.wal_write}`);
      console.log(`  wal_syncs:        ${wal.wal_sync}`);
      console.log(`  stats reset:      ${wal.stats_reset}`);
    } catch (err) {
      // Only swallow schema-mismatch errors (column / table missing between
      // PG versions). Anything else — auth failures, connection drops,
      // query cancellation — should surface as a real error.
      if (isSchemaMismatch(err)) {
        console.log(`  (pg_stat_wal not accessible on this PG version: ${(err as Error).message})`);
      } else {
        throw err;
      }
    }

    console.log("\n=== bgwriter / checkpointer ===");
    try {
      const [bg] = await sql<
        Array<{
          checkpoints_timed: string;
          checkpoints_req: string;
          checkpoint_write_time: string;
          buffers_checkpoint: string;
          buffers_clean: string;
          buffers_backend: string;
          buffers_alloc: string;
        }>
      >`
        SELECT
          checkpoints_timed::text, checkpoints_req::text,
          checkpoint_write_time::text, buffers_checkpoint::text,
          buffers_clean::text, buffers_backend::text, buffers_alloc::text
        FROM pg_stat_bgwriter
      `;
      console.log(`  checkpoints_timed:      ${bg.checkpoints_timed}`);
      console.log(`  checkpoints_req:        ${bg.checkpoints_req}  ← non-zero and high = frequent forced checkpoints`);
      console.log(`  checkpoint_write_time:  ${bg.checkpoint_write_time} ms`);
      console.log(`  buffers_checkpoint:     ${bg.buffers_checkpoint}  ← buffers flushed by checkpoints`);
      console.log(`  buffers_clean:          ${bg.buffers_clean}  ← buffers flushed by bgwriter`);
      console.log(`  buffers_backend:        ${bg.buffers_backend}  ← buffers written by backends (bad if high)`);
    } catch (err) {
      // Same rationale as the pg_stat_wal block above — in PG 17 the
      // columns we're reading (checkpoints_timed, buffers_clean, ...)
      // were moved into pg_stat_checkpointer, so a column-missing error
      // here is expected on newer PG tiers.
      if (isSchemaMismatch(err)) {
        console.log(`  (pg_stat_bgwriter not accessible on this PG version: ${(err as Error).message})`);
      } else {
        throw err;
      }
    }

    console.log("\n=== Cache hit ratio ===");
    const [hit] = await sql<
      Array<{ hit: string; miss: string; ratio: string }>
    >`
      SELECT
        sum(heap_blks_hit)::text AS hit,
        sum(heap_blks_read)::text AS miss,
        CASE WHEN sum(heap_blks_hit) + sum(heap_blks_read) > 0
          THEN ROUND(100.0 * sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)), 2)::text
          ELSE '—' END AS ratio
      FROM pg_statio_user_tables
    `;
    console.log(`  heap_blks_hit:  ${hit.hit}`);
    console.log(`  heap_blks_read: ${hit.miss}  ← disk reads`);
    console.log(`  cache hit %:    ${hit.ratio}%  (healthy is >95%)`);

    console.log("\n=== Currently running queries (all states, duration > 1s) ===");
    const active = await sql<
      Array<{
        pid: number;
        backend_type: string;
        state: string | null;
        wait_event_type: string | null;
        wait_event: string | null;
        duration: string | null;
        query: string | null;
      }>
    >`
      SELECT pid, backend_type, state, wait_event_type, wait_event,
        (now() - query_start)::text AS duration,
        LEFT(query, 200) AS query
      FROM pg_stat_activity
      WHERE state = 'active'
        AND query_start IS NOT NULL
        AND now() - query_start > interval '1 second'
        AND pid <> pg_backend_pid()
      ORDER BY query_start ASC
    `;
    if (active.length === 0) {
      console.log("  (nothing running > 1 second)");
    } else {
      for (const r of active) {
        console.log(`  pid=${r.pid} type=${r.backend_type} state=${r.state} wait=${r.wait_event_type}/${r.wait_event} dur=${r.duration}`);
        if (r.query && !r.query.includes("insufficient privilege")) {
          console.log(`    ${r.query.replace(/\s+/g, " ").slice(0, 180)}`);
        }
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
