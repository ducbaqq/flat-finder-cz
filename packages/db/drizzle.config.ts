import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://flat_finder:flat_finder_dev@localhost:5432/flat_finder",
  },
});
