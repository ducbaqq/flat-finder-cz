export async function apiGet<T>(
  endpoint: string,
  params?: Record<string, unknown>
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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
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
    throw new Error(`API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(endpoint: string): Promise<T> {
  const res = await fetch("/api" + endpoint, { method: "PATCH" });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete(endpoint: string): Promise<void> {
  const res = await fetch("/api" + endpoint, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
}
