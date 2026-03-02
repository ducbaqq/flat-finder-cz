import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });

const username = process.env.DB_USERNAME ?? "flat_finder";
const password = encodeURIComponent(process.env.DB_PASSWORD ?? "flat_finder_dev");
const host = process.env.DB_HOST ?? "localhost";
const port = process.env.DB_PORT ?? "5432";
const database = process.env.DB_DATABASE ?? "flat_finder";
const sslmode = process.env.DB_SSLMODE ?? "disable";

const url = `postgresql://${username}:${password}@${host}:${port}/${database}`;

const caPath = path.resolve(__dirname, "../../certs/ca-certificate.crt");

let ssl: string | boolean | undefined;
if (sslmode !== "disable") {
  if (fs.existsSync(caPath)) {
    // Append sslmode + CA cert path to the URL via query params
    ssl = `${caPath}`;
  } else {
    ssl = true;
  }
}

export default defineConfig({
  schema: "./src/schema/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: sslmode !== "disable" ? `${url}?sslmode=${sslmode}` : url,
    ssl,
  },
});
