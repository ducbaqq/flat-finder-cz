import { test, expect } from "@playwright/test";
import { clusterNewListings } from "../packages/db/src/queries/listings.js";
import type { Db } from "../packages/db/src/client.js";

/**
 * Structural mock tests — mirror the pattern used by clusterListings.spec.ts.
 * They verify clusterNewListings issues the expected sequence of execute()
 * calls and sums the returned rows correctly. They do NOT exercise the SQL
 * itself. Real SQL correctness is validated by running the script with
 * --apply against production data and spot-checking result rows.
 */
function makeMockDb(executeResults: unknown[][]) {
  const calls = { executes: [] as string[] };
  const resultQueue = [...executeResults];

  const db: Record<string, unknown> = {
    execute: async (query: unknown) => {
      calls.executes.push(String(query));
      return resultQueue.shift() ?? [];
    },
  };
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);

  return { db: db as unknown as Db, calls };
}

// Inside the transaction, clusterNewListings issues 3 execute() calls:
//   [0] SET LOCAL statement_timeout
//   [1] SET LOCAL work_mem
//   [2] the pipeline UPDATE ... RETURNING
const PRELUDE_LENGTH = 2;

test.describe("clusterNewListings", () => {
  test("returns zero counts when no candidates match", async () => {
    const { db, calls } = makeMockDb([
      [], // SET LOCAL statement_timeout
      [], // SET LOCAL work_mem
      [], // pipeline UPDATE RETURNING — no rows assigned
    ]);

    const result = await clusterNewListings(db);

    expect(result).toEqual({ clustered: 0, clusters: 0, joined_existing: 0 });
    expect(calls.executes).toHaveLength(PRELUDE_LENGTH + 1);
  });

  test("counts joined_existing separately from new-cluster members", async () => {
    const returningRows = [
      // Two candidates joined an existing cluster "existing-hash"
      { id: 101, cluster_id: "existing-hash", is_canonical: false, existing_cluster: true },
      { id: 102, cluster_id: "existing-hash", is_canonical: false, existing_cluster: true },
      // Three candidates formed a new cluster "new-hash"
      { id: 201, cluster_id: "new-hash", is_canonical: true, existing_cluster: false },
      { id: 202, cluster_id: "new-hash", is_canonical: false, existing_cluster: false },
      { id: 203, cluster_id: "new-hash", is_canonical: false, existing_cluster: false },
    ];

    const { db } = makeMockDb([
      [], // SET LOCAL statement_timeout
      [], // SET LOCAL work_mem
      returningRows,
    ]);

    const result = await clusterNewListings(db);

    expect(result).toEqual({
      clustered: 5,
      clusters: 2,
      joined_existing: 2,
    });
  });
});
