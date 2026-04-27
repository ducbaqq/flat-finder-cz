export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// Pull a human-readable error message from the response body. The API
// consistently returns { error: "<czech message>" } on non-2xx; fall back
// to a generic "API error: <status>" if the body is missing or unparseable.
async function readApiError(res: Response): Promise<ApiError> {
  let message = `API error: ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error.trim()) {
      message = body.error;
    }
  } catch {
    // not JSON — keep generic message
  }
  return new ApiError(res.status, message);
}

export async function apiGet<T>(
  endpoint: string,
  params?: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const qsParts: string[] = [];
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== "" && v !== null && v !== undefined) {
        qsParts.push(
          encodeURIComponent(k) + "=" + encodeURIComponent(String(v))
        );
      }
    });
  }
  const url = "/api" + endpoint + (qsParts.length ? "?" + qsParts.join("&") : "");
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) {
    throw await readApiError(res);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const res = await fetch("/api" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await readApiError(res);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(endpoint: string): Promise<T> {
  const res = await fetch("/api" + endpoint, { method: "PATCH" });
  if (!res.ok) {
    throw await readApiError(res);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete(endpoint: string): Promise<void> {
  const res = await fetch("/api" + endpoint, { method: "DELETE" });
  if (!res.ok) {
    throw await readApiError(res);
  }
}
