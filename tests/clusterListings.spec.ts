import { test, expect } from "@playwright/test";
import { clusterListings } from "../packages/db/src/queries/listings.js";
import type { Db } from "../packages/db/src/client.js";

/**
 * Build a mock Db that tracks execute() and update().set().where() calls.
 * `executeResults` is a queue: each db.execute() call shifts the next result.
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

// Inside the transaction, 4 execute() calls per run:
//   [0] SET LOCAL work_mem
//   [1] reset UPDATE
//   [2] geo-pass RETURNING
//   [3] address-pass RETURNING
const EMPTY_PRELUDE = [[], []];

test.describe("clusterListings", () => {
  test("returns zero counts when no duplicate clusters exist", async () => {
    const { db, calls } = makeMockDb([
      ...EMPTY_PRELUDE,
      [], // geo-pass RETURNING (no clusters)
      [], // address-pass RETURNING (no clusters)
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 0, clusters: 0 });
    // Inside the transaction: work_mem + reset + geo pass + address pass
    expect(calls.executes).toHaveLength(4);
  });

  test("counts geo-based clusters correctly", async () => {
    const geoRows = [
      { id: 1, cluster_id: "abc123" },
      { id: 2, cluster_id: "abc123" },
      { id: 3, cluster_id: "abc123" },
      { id: 10, cluster_id: "def456" },
      { id: 11, cluster_id: "def456" },
    ];

    const { db } = makeMockDb([
      ...EMPTY_PRELUDE,
      geoRows,  // geo pass — 2 clusters, 5 listings
      [],       // address pass — nothing left
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 5, clusters: 2 });
  });

  test("counts address-based clusters correctly when geo pass finds nothing", async () => {
    const addrRows = [
      { id: 100, cluster_id: "addr-aaa" },
      { id: 101, cluster_id: "addr-aaa" },
    ];

    const { db } = makeMockDb([
      ...EMPTY_PRELUDE,
      [],        // geo pass — no geo-based clusters
      addrRows,  // address pass — 1 cluster, 2 listings
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 2, clusters: 1 });
  });

  test("combines geo and address clusters in totals", async () => {
    const geoRows = [
      { id: 1, cluster_id: "geo-cluster-1" },
      { id: 2, cluster_id: "geo-cluster-1" },
    ];
    const addrRows = [
      { id: 50, cluster_id: "addr-cluster-1" },
      { id: 51, cluster_id: "addr-cluster-1" },
      { id: 52, cluster_id: "addr-cluster-1" },
    ];

    const { db } = makeMockDb([
      ...EMPTY_PRELUDE,
      geoRows,   // geo pass — 1 cluster, 2 listings
      addrRows,  // address pass — 1 cluster, 3 listings
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 5, clusters: 2 });
  });

  test("issues 4 statements inside the transaction: work_mem + reset + geo pass + address pass", async () => {
    const { db, calls } = makeMockDb([[], [], [], []]);

    await clusterListings(db);

    expect(calls.executes).toHaveLength(4);
  });
});
