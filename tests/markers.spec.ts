import { test, expect } from "@playwright/test";

const API = "http://localhost:4000";

test.describe("Markers API — raw points for Supercluster", () => {
  test("returns empty when no bounds provided", async ({ request }) => {
    const res = await request.get(`${API}/api/markers`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.markers).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  test("returns raw points within bounding box", async ({ request }) => {
    const res = await request.get(
      `${API}/api/markers?sw_lat=50.06&sw_lng=14.40&ne_lat=50.09&ne_lng=14.45`
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.markers.length).toBeGreaterThan(0);
    expect(data.total).toBe(data.markers.length);

    // Each point: {id, lat, lng, price} — nothing else
    const pt = data.markers[0];
    expect(pt).toHaveProperty("id");
    expect(pt).toHaveProperty("lat");
    expect(pt).toHaveProperty("lng");
    expect(pt).toHaveProperty("price");
    expect(Object.keys(pt)).toHaveLength(4);
  });

  test("all returned points fall within requested bounds", async ({
    request,
  }) => {
    const sw_lat = 50.06,
      sw_lng = 14.4,
      ne_lat = 50.09,
      ne_lng = 14.45;
    const res = await request.get(
      `${API}/api/markers?sw_lat=${sw_lat}&sw_lng=${sw_lng}&ne_lat=${ne_lat}&ne_lng=${ne_lng}`
    );
    const data = await res.json();

    for (const pt of data.markers) {
      expect(pt.lat).toBeGreaterThanOrEqual(sw_lat);
      expect(pt.lat).toBeLessThanOrEqual(ne_lat);
      expect(pt.lng).toBeGreaterThanOrEqual(sw_lng);
      expect(pt.lng).toBeLessThanOrEqual(ne_lng);
    }
  });

  test("filters narrow down results", async ({ request }) => {
    const bounds = "sw_lat=48.5&sw_lng=12.0&ne_lat=51.1&ne_lng=18.9";
    const [all, filtered] = await Promise.all([
      request.get(`${API}/api/markers?${bounds}`).then((r) => r.json()),
      request
        .get(`${API}/api/markers?${bounds}&source=bezrealitky`)
        .then((r) => r.json()),
    ]);

    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(all.total);
  });

  test("payload size is reasonable for a city viewport", async ({
    request,
  }) => {
    // Prague center — typical zoom 12 viewport
    const res = await request.get(
      `${API}/api/markers?sw_lat=50.0&sw_lng=14.3&ne_lat=50.15&ne_lng=14.6`
    );
    const body = await res.text();
    // Should be well under 2MB for a city viewport
    expect(body.length).toBeLessThan(2_000_000);
  });
});

test.describe("Frontend — map with Supercluster", () => {
  test("search page makes bounded markers request", async ({ page }) => {
    const [markersResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/markers"), {
        timeout: 20000,
      }),
      page.goto("http://localhost:3000/search"),
    ]);

    const url = markersResponse.url();
    expect(url).toContain("sw_lat=");
    expect(url).toContain("ne_lat=");

    const data = await markersResponse.json();
    expect(data.markers).toBeDefined();
    expect(data.total).toBeGreaterThan(0);
  });

  test("map renders clusters and/or markers", async ({ page }) => {
    await page.goto("http://localhost:3000/search");

    const mapContainer = page.locator(".leaflet-container");
    await expect(mapContainer).toBeVisible({ timeout: 15000 });

    // Wait for Supercluster to process and render
    await page.waitForTimeout(5000);

    // Should have interactive elements (CircleMarker SVGs or Marker divIcons)
    const elements = page.locator(
      ".leaflet-interactive, .leaflet-marker-icon"
    );
    const count = await elements.count();
    expect(count).toBeGreaterThan(0);
  });
});
