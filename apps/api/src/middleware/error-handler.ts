import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  console.error("Unhandled error:", err);

  const message =
    err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message }, 500);
};
