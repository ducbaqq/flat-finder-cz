import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from scrapers-new root (sibling of src/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file is optional
}

/** Parse --max-pages=N from CLI args. Returns Infinity if not specified. */
export function parseMaxPages(): number {
  const arg = process.argv.find((a) => a.startsWith("--max-pages="));
  if (!arg) return Infinity;
  const val = parseInt(arg.split("=")[1], 10);
  return isNaN(val) ? Infinity : val;
}

const DEFAULT_RPS: Record<string, number> = {
  bazos: 20,
  ereality: 10,
  eurobydleni: 10,
  realitymix: 5,
  ceskereality: 5,
  idnes: 5,
  realingo: 5,
};

/** Get RPS for a scraper from env var RPS_<NAME> or built-in default. */
export function getRps(scraperName: string): number {
  const envKey = `RPS_${scraperName.toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_RPS[scraperName] ?? 5;
}
