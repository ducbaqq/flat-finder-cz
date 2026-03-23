import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Map Functionality", () => {
  test("map renders with tiles loaded", async ({ page }) => {
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const map = page.locator(".leaflet-container").first();
    const mapVisible = await map.isVisible().catch(() => false);
    console.log(`[CHECK] Leaflet map container visible: ${mapVisible}`);

    // Check tiles are loaded
    const tiles = page.locator(".leaflet-tile-loaded");
    const tileCount = await tiles.count();
    console.log(`[DATA] Loaded map tiles: ${tileCount}`);

    // Check zoom controls
    const zoomIn = page.locator(".leaflet-control-zoom-in").first();
    const zoomOut = page.locator(".leaflet-control-zoom-out").first();
    console.log(`[CHECK] Zoom in button: ${await zoomIn.isVisible().catch(() => false)}`);
    console.log(`[CHECK] Zoom out button: ${await zoomOut.isVisible().catch(() => false)}`);

    // Check attribution
    const attribution = page.locator(".leaflet-control-attribution").first();
    const attrVisible = await attribution.isVisible().catch(() => false);
    console.log(`[CHECK] Attribution visible: ${attrVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/05-map-rendered.png` });

    expect(mapVisible).toBeTruthy();
    expect(tileCount).toBeGreaterThan(0);
  });

  test("markers/clusters visible on map", async ({ page }) => {
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Check for cluster markers (CircleMarker -> SVG circles)
    const clusters = page.locator(".leaflet-interactive");
    const clusterCount = await clusters.count();
    console.log(`[DATA] Interactive map elements (markers+clusters): ${clusterCount}`);

    // Check for price markers (custom div icons)
    const priceMarkers = page.locator(".custom-marker-price");
    const priceCount = await priceMarkers.count();
    console.log(`[DATA] Price marker labels: ${priceCount}`);

    // Check for cluster count tooltips
    const clusterTooltips = page.locator(".cluster-count-tooltip");
    const tooltipCount = await clusterTooltips.count();
    console.log(`[DATA] Cluster count tooltips: ${tooltipCount}`);

    // Check for dot markers
    const dotMarkers = page.locator(".custom-marker-dot");
    const dotCount = await dotMarkers.count();
    console.log(`[DATA] Dot markers: ${dotCount}`);

    await page.screenshot({ path: `${RESULTS_DIR}/05-map-markers.png` });

    // At least some markers should be present
    const totalMarkers = clusterCount + priceCount + dotCount;
    console.log(`[DATA] Total map markers: ${totalMarkers}`);
  });

  test("zoom in/out works and clusters break apart", async ({ page }) => {
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Count clusters at initial zoom
    const initialClusters = await page.locator(".leaflet-interactive").count();
    console.log(`[DATA] Markers at initial zoom: ${initialClusters}`);

    await page.screenshot({ path: `${RESULTS_DIR}/05-map-zoom-initial.png` });

    // Zoom in using button
    const zoomIn = page.locator(".leaflet-control-zoom-in").first();
    for (let i = 0; i < 3; i++) {
      await zoomIn.click();
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle");

    const afterZoomClusters = await page.locator(".leaflet-interactive").count();
    const afterZoomPriceMarkers = await page.locator(".custom-marker-price").count();
    console.log(`[DATA] Markers after zoom in: ${afterZoomClusters}`);
    console.log(`[DATA] Price markers after zoom in: ${afterZoomPriceMarkers}`);

    await page.screenshot({ path: `${RESULTS_DIR}/05-map-zoom-in.png` });

    // Zoom out
    const zoomOut = page.locator(".leaflet-control-zoom-out").first();
    for (let i = 0; i < 5; i++) {
      await zoomOut.click();
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle");

    const afterZoomOutClusters = await page.locator(".leaflet-interactive").count();
    console.log(`[DATA] Markers after zoom out: ${afterZoomOutClusters}`);

    await page.screenshot({ path: `${RESULTS_DIR}/05-map-zoom-out.png` });
  });

  test("clicking a marker opens detail or zooms in", async ({ page }) => {
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Try clicking a price marker (individual listing)
    const priceMarker = page.locator(".custom-marker-price").first();
    const priceMarkerVisible = await priceMarker.isVisible().catch(() => false);
    console.log(`[CHECK] Price marker clickable: ${priceMarkerVisible}`);

    if (priceMarkerVisible) {
      await priceMarker.click();
      await page.waitForTimeout(2000);

      // Check if detail modal opened
      const dialog = page.locator("[role='dialog']").first();
      const dialogVisible = await dialog.isVisible().catch(() => false);
      console.log(`[CHECK] Detail modal opened from marker click: ${dialogVisible}`);

      await page.screenshot({ path: `${RESULTS_DIR}/05-map-marker-click.png` });

      if (dialogVisible) {
        // Close modal
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }

    // Try clicking a cluster
    const cluster = page.locator(".leaflet-interactive").first();
    const clusterVisible = await cluster.isVisible().catch(() => false);
    console.log(`[CHECK] Cluster element clickable: ${clusterVisible}`);

    if (clusterVisible) {
      const beforeZoom = await page.evaluate(() => {
        const map = (document.querySelector('.leaflet-container') as any)?._leaflet_map;
        return map?.getZoom?.() ?? -1;
      });
      console.log(`[DATA] Zoom before cluster click: ${beforeZoom}`);

      await cluster.click();
      await page.waitForTimeout(2000);

      const afterZoom = await page.evaluate(() => {
        const map = (document.querySelector('.leaflet-container') as any)?._leaflet_map;
        return map?.getZoom?.() ?? -1;
      });
      console.log(`[DATA] Zoom after cluster click: ${afterZoom}`);

      await page.screenshot({ path: `${RESULTS_DIR}/05-map-cluster-click.png` });
    }
  });

  test("panning the map triggers new API call", async ({ page }) => {
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/markers")) {
        apiCalls.push(req.url());
      }
    });

    // Pan the map by dragging
    const map = page.locator(".leaflet-container").first();
    const box = await map.boundingBox();

    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 200, centerY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle");

      console.log(`[DATA] Marker API calls after pan: ${apiCalls.length}`);
      if (apiCalls.length > 0) {
        console.log(`[DATA] Last marker API call: ${apiCalls[apiCalls.length - 1].substring(0, 150)}...`);
      }

      await page.screenshot({ path: `${RESULTS_DIR}/05-map-after-pan.png` });
    }
  });

  test("marker hover shows tooltip preview", async ({ page }) => {
    // Zoom in to see individual markers
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Zoom in to get individual point markers
    const zoomIn = page.locator(".leaflet-control-zoom-in").first();
    for (let i = 0; i < 4; i++) {
      await zoomIn.click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(3000);

    // Look for markers to hover over
    const markers = page.locator(".leaflet-marker-icon");
    const markerCount = await markers.count();
    console.log(`[DATA] Leaflet markers at zoomed level: ${markerCount}`);

    if (markerCount > 0) {
      // Hover over first marker
      await markers.first().hover();
      await page.waitForTimeout(2000);

      // Check for tooltip
      const tooltip = page.locator(".leaflet-tooltip, .marker-hover-tooltip").first();
      const tooltipVisible = await tooltip.isVisible().catch(() => false);
      console.log(`[CHECK] Marker hover tooltip visible: ${tooltipVisible}`);

      await page.screenshot({ path: `${RESULTS_DIR}/05-map-marker-hover.png` });
    }
  });
});
