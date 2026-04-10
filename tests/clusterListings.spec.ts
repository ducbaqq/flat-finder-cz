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

  const db = {
    execute: async (query: unknown) => {
      const queryStr = String(query);
      calls.executes.push(queryStr);
      return resultQueue.shift() ?? [];
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          calls.updates.push({ set: values, whereIds: [] });
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as Db;

  return { db, calls };
}

test.describe("clusterListings", () => {
  test("returns zero counts when no duplicate clusters exist", async () => {
    const { db, calls } = makeMockDb([
      [], // reset UPDATE result
      [], // phone-pass RETURNING (no clusters)
      [], // geo-pass RETURNING (no clusters)
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 0, clusters: 0 });
    // 3 SQL statements: reset + phone pass + geo pass
    expect(calls.executes).toHaveLength(3);
  });

  test("counts phone-based clusters correctly", async () => {
    const phoneRows = [
      { id: 1, cluster_id: "abc123" },
      { id: 2, cluster_id: "abc123" },
      { id: 3, cluster_id: "abc123" },
      { id: 10, cluster_id: "def456" },
      { id: 11, cluster_id: "def456" },
    ];

    const { db } = makeMockDb([
      [],         // reset
      phoneRows,  // phone pass — 2 clusters, 5 listings
      [],         // geo pass — nothing left
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 5, clusters: 2 });
  });

  test("counts geo-based clusters correctly when phone pass finds nothing", async () => {
    const geoRows = [
      { id: 100, cluster_id: "geo-aaa" },
      { id: 101, cluster_id: "geo-aaa" },
    ];

    const { db } = makeMockDb([
      [],        // reset
      [],        // phone pass — no phone-based clusters
      geoRows,   // geo pass — 1 cluster, 2 listings
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 2, clusters: 1 });
  });

  test("combines phone and geo clusters in totals", async () => {
    const phoneRows = [
      { id: 1, cluster_id: "phone-cluster-1" },
      { id: 2, cluster_id: "phone-cluster-1" },
    ];
    const geoRows = [
      { id: 50, cluster_id: "geo-cluster-1" },
      { id: 51, cluster_id: "geo-cluster-1" },
      { id: 52, cluster_id: "geo-cluster-1" },
    ];

    const { db } = makeMockDb([
      [],          // reset
      phoneRows,   // phone pass — 1 cluster, 2 listings
      geoRows,     // geo pass — 1 cluster, 3 listings
    ]);

    const result = await clusterListings(db);

    expect(result).toEqual({ clustered: 5, clusters: 2 });
  });

  test("issues exactly 3 SQL statements: reset + phone pass + geo pass", async () => {
    const { db, calls } = makeMockDb([[], [], []]);

    await clusterListings(db);

    expect(calls.executes).toHaveLength(3);
  });
});
