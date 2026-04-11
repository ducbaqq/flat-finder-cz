import { test, expect } from "@playwright/test";
import { clusterListings } from "../packages/db/src/queries/listings.js";
import type { Db } from "../packages/db/src/client.js";

/**
 * Build a mock Db that tracks execute() and update().set().where() calls.
 * `executeResults` is a queue: each db.execute() call shifts the next result.
 *
 * NOTE: these tests are structural — they verify that clusterListings issues
 * the expected sequence of execute() calls and sums the returned rows
 * correctly. They do not exercise the SQL itself. Real SQL correctness is
 * validated by running --dedupe against production data and inspecting the
 * resulting cluster distribution via scripts/dedup-stats.ts.
 */
function makeMockDb(executeResults: unknown[][]) {
  const calls = {
    executes: [] as string[],
    updates: [] as Array<{ set: Record<string, unknown>; whereIds: number[] }>,
  };

  const resultQueue = [...executeResults];

  const db: Record<string, unknown> = {
    execute: async (query: unknown) => {
      const queryStr = String(query);
      calls.executes.push(queryStr);
      return resultQueue.shift() ?? [];
    },
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (_condition: unknown) => {
          calls.updates.push({ set: values, whereIds: [] });
          return Promise.resolve([]);
        },
      }),
    }),
  };
  // Minimal transaction shim: hand the callback `db` as the tx executor.
  // Any throw from inside the callback propagates out, matching drizzle's
  // behaviour (commit on return, rollback on throw).
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);

  return { db: db as unknown as Db, calls };
}

// Inside the transaction, clusterListings issues 3 execute() calls:
//   [0] SET LOCAL work_mem
//   [1] reset UPDATE (cluster_id = NULL)
//   [2] clustering UPDATE ... RETURNING
const PRELUDE_LENGTH = 2;

test.describe("clusterListings", () => {
  test("returns zero counts when no duplicates exist", async () => {
    const { db, calls } = makeMockDb([
      [], // SET LOCAL work_mem
      [], // reset UPDATE
      [], // clustering UPDATE RETURNING — no clusters
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 0, clusters: 0 });
    expect(calls.executes).toHaveLength(PRELUDE_LENGTH + 1);
  });

  test("counts clustered rows and distinct clusters", async () => {
    const clusteredRows = [
      { id: 1, cluster_id: "abc123" },
      { id: 2, cluster_id: "abc123" },
      { id: 3, cluster_id: "abc123" },
      { id: 10, cluster_id: "def456" },
      { id: 11, cluster_id: "def456" },
    ];

    const { db } = makeMockDb([
      [], // SET LOCAL work_mem
      [], // reset UPDATE
      clusteredRows, // clustering UPDATE RETURNING — 2 clusters, 5 rows
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 5, clusters: 2 });
  });

  test("dry-run rolls back via sentinel error but still returns counts", async () => {
    const clusteredRows = [
      { id: 1, cluster_id: "hash-1" },
      { id: 2, cluster_id: "hash-1" },
    ];

    const { db } = makeMockDb([
      [], // SET LOCAL work_mem
      [], // reset UPDATE
      clusteredRows,
    ]);

    // Should not throw, and should return the counts the pipeline computed
    // before the sentinel-triggered rollback.
    const result = await clusterListings(db, { dryRun: true });

    expect(result).toEqual({ clustered: 2, clusters: 1 });
  });
});
