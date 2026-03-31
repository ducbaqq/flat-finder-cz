import { test, expect } from "@playwright/test";
import { deduplicateListings } from "../packages/db/src/queries/listings.js";
import type { Db } from "../packages/db/src/client.js";

// Build a chainable drizzle-style mock for db.update().set().where()
function makeUpdateChain() {
  const calls = { update: 0, set: 0, where: 0, setArgs: [] as unknown[] };
  const where = () => { calls.where++; return Promise.resolve([]); };
  const set = (args: unknown) => { calls.set++; calls.setArgs.push(args); return { where }; };
  const update = () => { calls.update++; return { set }; };
  return { update, calls };
}

test.describe("deduplicateListings", () => {
  test("returns zero counts and skips UPDATE when no duplicates exist", async () => {
    const { update, calls } = makeUpdateChain();
    const db = {
      execute: async () => [],
      update,
    } as unknown as Db;

    const result = await deduplicateListings(db);

    expect(result).toEqual({ found: 0, deactivated: 0 });
    expect(calls.update).toBe(0);
  });

  test("deactivates duplicate rows in a single chunk when count < 500", async () => {
    const duplicates = [{ id: 2 }, { id: 3 }, { id: 5 }];
    const { update, calls } = makeUpdateChain();
    const db = {
      execute: async () => duplicates,
      update,
    } as unknown as Db;

    const result = await deduplicateListings(db);

    expect(result).toEqual({ found: 3, deactivated: 3 });
    expect(calls.update).toBe(1);
    expect(calls.set).toBe(1);
    expect(calls.where).toBe(1);
    const setArg = calls.setArgs[0] as Record<string, unknown>;
    expect(setArg.is_active).toBe(false);
    expect(typeof setArg.deactivated_at).toBe("string");
  });

  test("splits deactivation into chunks of 500", async () => {
    const duplicates = Array.from({ length: 1200 }, (_, i) => ({ id: i + 2 }));
    const { update, calls } = makeUpdateChain();
    const db = {
      execute: async () => duplicates,
      update,
    } as unknown as Db;

    const result = await deduplicateListings(db);

    expect(result).toEqual({ found: 1200, deactivated: 1200 });
    // 1200 → 3 chunks (500 + 500 + 200)
    expect(calls.update).toBe(3);
    expect(calls.set).toBe(3);
    expect(calls.where).toBe(3);
  });
});
