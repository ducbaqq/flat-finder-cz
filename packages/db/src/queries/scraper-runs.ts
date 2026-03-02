import { eq } from "drizzle-orm";
import { scraperRuns, type NewScraperRun, type ScraperRunRow } from "../schema/scraper-runs.js";
import type { Db } from "../client.js";

export async function createScraperRun(
  db: Db,
  data: NewScraperRun,
): Promise<ScraperRunRow> {
  const result = await db.insert(scraperRuns).values(data).returning();
  return result[0];
}

export async function finishScraperRun(
  db: Db,
  id: number,
  data: Partial<NewScraperRun>,
): Promise<void> {
  await db
    .update(scraperRuns)
    .set({ ...data, finished_at: new Date().toISOString() })
    .where(eq(scraperRuns.id, id));
}
