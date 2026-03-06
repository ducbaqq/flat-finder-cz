/**
 * Run all scrapers sequentially.
 * Usage: npx tsx src/run-all.ts [--max-pages=N]
 *
 * By default scrapes everything. Use --max-pages=5 to limit for testing.
 */
import { parseMaxPages, getRps } from "./cli.js";

const maxPages = parseMaxPages();

console.log(`Running all scrapers with maxPages=${maxPages === Infinity ? "unlimited" : maxPages}\n`);

const scrapers = [
  { name: "idnes", module: "./idnes.js" },
  { name: "bazos", module: "./bazos.js" },
  { name: "ceskereality", module: "./ceskereality.js" },
  { name: "realingo", module: "./realingo.js" },
  { name: "ereality", module: "./ereality.js" },
  { name: "realitymix", module: "./realitymix.js" },
  { name: "eurobydleni", module: "./eurobydleni.js" },
];

for (const { name, module: mod } of scrapers) {
  const rps = getRps(name);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Starting: ${name}`);
  console.log("=".repeat(60));

  try {
    const imported = await import(mod);
    const ScraperClass = Object.values(imported).find(
      (v): v is new (...args: unknown[]) => { run(): Promise<void> } =>
        typeof v === "function" && v.prototype && typeof v.prototype.run === "function",
    );

    if (!ScraperClass) {
      console.error(`  No scraper class found in ${mod}`);
      continue;
    }

    const scraper = new ScraperClass({ name, rps, maxPages });
    await scraper.run();
  } catch (err) {
    console.error(`  ERROR running ${name}: ${err}`);
  }
}

console.log("\n\nAll scrapers finished. Run 'npx tsx src/verify-all.ts' to see results.");
