import { expect, type Page, test } from "@playwright/test";

type GeoJSONFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "LineString" | "Polygon"; coordinates: unknown };
  properties: Record<string, unknown>;
  workbench: { style: { strokeColor: string; strokeWidth: number }; layerId: string };
};

type GeoJSONLayer = {
  id: string;
  name: string;
  visible: boolean;
  order: number;
  createdAt: string;
};

const gotoApp = async (page: Page) => {
  await page.goto("./");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
};

const persistentRows = (page: Page) => page.locator('tbody tr[data-query-selection="persistent"]');

const queryPersistentIds = async (page: Page, expectedIds: string[]) => {
  await page.getByTestId("sql-editor").fill("SELECT id FROM geometry_features ORDER BY id");
  const runQuery = page.getByRole("button", { name: "Run query" });
  await expect(runQuery).toBeEnabled({ timeout: 30_000 });
  await runQuery.click();
  await expect(page.getByTestId("query-status")).toHaveText(expectedIds.length === 0 ? "empty" : "success", {
    timeout: 30_000,
  });
  const rows = persistentRows(page);
  await expect(rows).toHaveCount(expectedIds.length);
  await expect
    .poll(async () => (await rows.locator("td:first-child").allInnerTexts()).sort(), {
      message: `repository should contain exactly: ${expectedIds.join(", ")}`,
    })
    .toEqual([...expectedIds].sort());
};

const clearFeatures = async (page: Page) => {
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".layer-item__count")).toHaveText("0");
  await queryPersistentIds(page, []);
};

const importFeatures = async (
  page: Page,
  features: GeoJSONFeature[],
  options: { fileName?: string; layers?: GeoJSONLayer[] } = {}
) => {
  await page.locator("#geojson-file-input").setInputFiles({
    name: options.fileName ?? "selection-features.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(
      JSON.stringify({
        type: "FeatureCollection",
        features,
        ...(options.layers ? { workbench: { layers: options.layers } } : {}),
      })
    ),
  });
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await page.locator(".layer-item__count").allInnerTexts()).reduce(
          (total, count) => total + Number.parseInt(count, 10),
          0
        ),
      { message: "imported feature count should be visible before querying repository identities" }
    )
    .toBe(features.length);
  await queryPersistentIds(
    page,
    features.map(({ id }) => id)
  );
};

const lineFeature = (
  id: string,
  coordinates: [[number, number], [number, number]],
  strokeWidth = 4,
  layerId = "default"
): GeoJSONFeature => ({
  type: "Feature",
  id,
  geometry: { type: "LineString", coordinates },
  properties: {},
  workbench: { style: { strokeColor: "#222222", strokeWidth }, layerId },
});

const polygonFeature = (id: string, coordinates: [number, number][], strokeWidth = 4): GeoJSONFeature => ({
  type: "Feature",
  id,
  geometry: { type: "Polygon", coordinates: [coordinates] },
  properties: {},
  workbench: { style: { strokeColor: "#cc0000", strokeWidth }, layerId: "default" },
});

test.describe("TASK-2.2 feature selection", () => {
  test("同順位の後勝ち・太線の表示端部・SQLキーボード加算選択を実ブラウザーで確認する", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);

    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    const clickCanvas = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
    const status = page.getByTestId("selection-status");
    // Two same-layer lines have the same renderOrder. The later feature must win at their overlap.
    await importFeatures(page, [
      lineFeature("overlap-first", [
        [100, 100],
        [300, 200],
      ]),
      lineFeature("overlap-later", [
        [100, 100],
        [300, 200],
      ]),
      lineFeature(
        "wide-line",
        [
          [100, 300],
          [300, 300],
        ],
        40
      ),
      lineFeature("thin-line", [
        [100, 300],
        [300, 300],
      ]),
    ]);
    await expect(page.locator(".layer-item__count")).toHaveText("4");
    await page.getByRole("button", { name: "Measure" }).click();
    await clickCanvas(200, 150);
    await expect(status).toHaveText("選択: 1件 (persistent:overlap-later)");

    // 18px from the centerline is outside the old 14px tolerance but inside a 40px stroke's visible half-width.
    await clickCanvas(200, 318);
    await expect(status).toHaveText("選択: 1件 (persistent:wide-line)");

    // Keyboard modifiers must preserve the additive selection behavior for both supported keys/modifiers.
    await clearFeatures(page);
    await importFeatures(page, [
      lineFeature("keyboard-one", [
        [100, 100],
        [180, 100],
      ]),
      lineFeature("keyboard-two", [
        [100, 200],
        [180, 200],
      ]),
      lineFeature("keyboard-three", [
        [100, 300],
        [180, 300],
      ]),
      lineFeature("keyboard-four", [
        [100, 400],
        [180, 400],
      ]),
    ]);
    await expect(page.locator(".layer-item__count")).toHaveText("4");
    await page.getByTestId("sql-editor").fill("SELECT id FROM geometry_features ORDER BY feature_order");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const rows = page.locator('tbody tr[data-query-selection="persistent"]');
    await expect(rows).toHaveCount(4);

    await rows.nth(0).click();
    await expect(status).toHaveText("選択: 1件 (persistent:keyboard-one)");
    await rows.nth(1).press("Control+Enter");
    await expect(status).toHaveText(/選択: 2件/);
    await rows.nth(2).press("Meta+Space");
    await expect(status).toHaveText(/選択: 3件/);
    await rows.nth(3).press("Control+Space");
    await expect(status).toHaveText(/選択: 4件/);

    // Meta+Enter follows the same additive path after replacing the selection.
    await clickCanvas(box.width - 30, box.height - 30);
    await rows.nth(0).click();
    await rows.nth(1).press("Meta+Enter");
    await expect(status).toHaveText(/選択: 2件/);
  });

  test("選択済みの下位重複strokeを再クリックしても選択を維持する", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    await importFeatures(
      page,
      [
        {
          type: "Feature",
          id: "overlap-first",
          geometry: {
            type: "LineString",
            coordinates: [
              [100, 100],
              [300, 200],
            ],
          },
          properties: {},
          workbench: { style: { strokeColor: "#222222", strokeWidth: 4 }, layerId: "default" },
        },
        {
          type: "Feature",
          id: "overlap-later",
          geometry: {
            type: "LineString",
            coordinates: [
              [100, 100],
              [300, 200],
            ],
          },
          properties: {},
          workbench: { style: { strokeColor: "#cc0000", strokeWidth: 4 }, layerId: "default" },
        },
      ],
      { fileName: "selection-selected-overlap.geojson" }
    );
    await page.getByTestId("sql-editor").fill("SELECT id FROM geometry_features ORDER BY feature_order");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const rows = page.locator('tbody tr[data-query-selection="persistent"]');
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: "Measure" }).click();
    await rows.nth(0).click();
    const status = page.getByTestId("selection-status");
    await expect(status).toHaveText("選択: 1件 (persistent:overlap-first)");
    await page.mouse.click(box.x + 200, box.y + 150);
    await expect(status).toHaveText("選択: 1件 (persistent:overlap-first)");
  });

  test("polygon, topmost temporary geometry, and id-only SQL rows select correctly", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      if (
        (message.type() === "error" || message.type() === "warning") &&
        !message.text().includes("GPU stall due to ReadPixels")
      ) {
        consoleIssues.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));

    // 1. Draw and persist a polygon, then wait for its saved feature count to become observable.
    await gotoApp(page);
    await clearFeatures(page);
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    const clickCanvas = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
    // The fixture polygon occupies model pixels 100..300 in both axes. Keep
    // the clear point well inside the canvas while outside that known extent.
    const clearPoint = {
      x: Math.min(box.width - 24, 360),
      y: Math.min(box.height - 24, 120),
    };
    await clickCanvas(100, 100);
    await clickCanvas(300, 100);
    await clickCanvas(300, 300);
    await clickCanvas(100, 300);
    await clickCanvas(105, 105);
    await page.keyboard.press("Escape");
    await expect(page.locator(".layer-item__count")).toHaveText("1", { timeout: 10_000 });

    // 2. In Measure mode, select the polygon from its interior and boundary, then clear it from outside whitespace.
    await page.getByTestId("sql-editor").fill("SELECT id FROM geometry_features");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const polygonRow = page.locator('tbody tr[data-query-selection="persistent"]');
    await expect(polygonRow).toHaveCount(1);
    const polygonId = await polygonRow.locator("td:first-child").innerText();
    const status = page.getByTestId("selection-status");
    await page.getByRole("button", { name: "Measure" }).click();
    await clickCanvas(200, 200);
    await expect(status).toHaveText(`選択: 1件 (persistent:${polygonId})`);
    await clickCanvas(200, 100);
    await expect(status).toHaveText(`選択: 1件 (persistent:${polygonId})`);
    await clickCanvas(clearPoint.x, clearPoint.y);
    await expect(status).toHaveText("選択: 0件");

    // 3. Replace the polygon with a persistent line and render an ID-less temporary query line at identical coordinates.
    await clearFeatures(page);
    await expect(page.locator(".layer-item__count")).toHaveText("0");
    await page.getByRole("button", { name: "Draw" }).click();
    await clickCanvas(100, 100);
    await clickCanvas(300, 200);
    await page.keyboard.press("Escape");
    await expect(page.locator(".layer-item__count")).toHaveText("1", { timeout: 10_000 });
    await page
      .getByTestId("sql-editor")
      .fill(
        "SELECT 'frontmost' AS name, ST_AsGeoJSON(ST_GeomFromText('LINESTRING (100 100, 300 200)')) AS geometry_geojson"
      );
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const temporaryRow = page.locator('tbody tr[data-query-selection="temporary"]');
    await expect(temporaryRow).toHaveCount(1);
    await expect(temporaryRow).not.toHaveAttribute("data-selected", "true");

    // 4. Click the overlapping canvas geometry and verify the visually topmost temporary identity wins selection.
    await page.getByRole("button", { name: "Measure" }).click();
    await clickCanvas(200, 150);
    await expect(status).toHaveText(/選択: 1件 \(temporary:[^)]+\)/);
    await expect(status).not.toContainText("persistent:");
    await expect(temporaryRow).toHaveAttribute("data-selected", "true");

    // 5. Query only canonical IDs, click the row, and verify persistent status and canvas highlighting update together.
    await page.getByTestId("sql-editor").fill("SELECT id FROM geometry_features");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    await expect(status).toHaveText("選択: 0件");
    const idOnlyRow = page.locator('tbody tr[data-query-selection="persistent"]');
    await expect(idOnlyRow).toHaveCount(1);
    const persistentId = await idOnlyRow.locator("td:first-child").innerText();
    const canvasBeforeIdSelection = await canvas.screenshot();
    await idOnlyRow.click();
    await expect(status).toHaveText(`選択: 1件 (persistent:${persistentId})`);
    await expect(idOnlyRow).toHaveAttribute("data-selected", "true");
    await expect
      .poll(async () => (await canvas.screenshot()).equals(canvasBeforeIdSelection), {
        message: "canonical ID row selection should update the canvas highlight",
      })
      .toBe(false);

    // 6. Verify the real browser journey produced no console issues, uncaught page errors, or failed requests.
    expect(consoleIssues).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("canvas and SQL table selection stay synchronized without conflicting with interaction modes", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      if (
        (message.type() === "error" || message.type() === "warning") &&
        !message.text().includes("GPU stall due to ReadPixels")
      ) {
        consoleIssues.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));

    // 1. Create two persistent features and wait until both are observable from the saved feature count.
    await gotoApp(page);
    await clearFeatures(page);
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    const firstMidpoint = { x: box.x + 170, y: box.y + 140 };
    const secondMidpoint = { x: box.x + 170, y: box.y + 340 };
    await page.mouse.click(box.x + 100, box.y + 100);
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + 100, box.y + 300);
    await page.mouse.click(box.x + 240, box.y + 380);
    await page.keyboard.press("Escape");
    await expect(page.locator(".layer-item__count")).toHaveText("2", { timeout: 10_000 });

    // 2. Query canonical IDs, then select the first feature on canvas in Measure mode and verify its SQL row is synchronized.
    await page.getByTestId("sql-editor").fill("SELECT id, geometry_geojson FROM geometry_features ORDER BY created_at");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const persistentRows = page.locator('tbody tr[data-query-selection="persistent"]');
    await expect(persistentRows).toHaveCount(2);
    const queriedIds = await persistentRows.locator("td:first-child").allInnerTexts();
    await page.getByRole("button", { name: "Measure" }).click();
    const status = page.getByTestId("selection-status");
    await expect(status).toHaveText("選択: 0件");
    await page.mouse.click(firstMidpoint.x, firstMidpoint.y);
    const firstSelectionText = await status.innerText();
    const firstId = firstSelectionText.match(/persistent:([^),]+)/)?.[1];
    if (!firstId || !queriedIds.includes(firstId))
      throw new Error("canvas selection did not expose a queried canonical ID");
    const secondId = queriedIds.find((id) => id !== firstId);
    if (!secondId) throw new Error("second queried canonical ID was not available");
    await expect(status).toContainText(`persistent:${firstId}`);
    await expect(persistentRows.filter({ has: page.locator("td:first-child", { hasText: firstId }) })).toHaveAttribute(
      "data-selected",
      "true"
    );

    // 3. Add and remove the second feature with Ctrl/Meta semantics, then clear all selection by clicking canvas whitespace.
    await page.keyboard.down("Control");
    await page.mouse.click(secondMidpoint.x, secondMidpoint.y);
    await page.keyboard.up("Control");
    await expect(status).toContainText("選択: 2件");
    await expect(status).toContainText(`persistent:${secondId}`);
    await expect(page.locator('tbody tr[data-query-selection][data-selected="true"]')).toHaveCount(2);
    await page.keyboard.down("Control");
    await page.mouse.click(secondMidpoint.x, secondMidpoint.y);
    await page.keyboard.up("Control");
    await expect(status).toHaveText(`選択: 1件 (persistent:${firstId})`);
    await page.mouse.click(box.x + box.width - 30, box.y + 30);
    await expect(status).toHaveText("選択: 0件");

    // 4. Select a canonical SQL result row and verify canvas/status synchronization uses the same persistent identity.
    const secondRow = persistentRows.filter({ has: page.locator("td:first-child", { hasText: secondId }) });
    await secondRow.click();
    await expect(status).toHaveText(`選択: 1件 (persistent:${secondId})`);
    await expect(secondRow).toHaveAttribute("data-selected", "true");

    // 5. Click the selected geometry in Draw, Edit, and Pan modes and verify those interactions do not change selection.
    for (const mode of ["Draw", "Edit", "Pan"] as const) {
      await page.getByRole("button", { name: mode }).click();
      await page.mouse.click(secondMidpoint.x, secondMidpoint.y);
      await expect(status).toHaveText(`選択: 1件 (persistent:${secondId})`);
    }

    // 6. Select an ID-less query geometry and verify it has a temporary identity distinct from persistent features.
    await page.getByRole("button", { name: "Measure" }).click();
    await page
      .getByTestId("sql-editor")
      .fill(
        "SELECT 'constructed' AS name, ST_AsGeoJSON(ST_GeomFromText('LINESTRING (100 100, 300 200)')) AS geometry_geojson"
      );
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const temporaryRow = page.locator('tbody tr[data-query-selection="temporary"]');
    await expect(temporaryRow).toHaveCount(1);
    await temporaryRow.click();
    await expect(temporaryRow).toHaveAttribute("data-selected", "true");
    await expect(status).toHaveText(/選択: 1件 \(temporary:/);
    await expect(status).not.toContainText("persistent:");

    // 7. Replace the query and reload, verifying stale temporary selection is cleaned up across both lifecycle boundaries.
    await page.getByTestId("sql-editor").fill("SELECT id FROM geometry_features");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    await expect(status).toHaveText("選択: 0件");
    await page.mouse.click(firstMidpoint.x, firstMidpoint.y);
    await expect(status).toHaveText(`選択: 1件 (persistent:${firstId})`);
    await page.reload();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("selection-status")).toHaveText("選択: 0件");

    // 8. Verify the real browser journey produced no console issues, uncaught page errors, or failed requests.
    expect(consoleIssues).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("可視strokeは手前の見えないクリック余白より優先する", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);

    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    await importFeatures(
      page,
      [
        lineFeature(
          "wide-persistent",
          [
            [100, 350],
            [300, 350],
          ],
          40
        ),
      ],
      { fileName: "selection-boundary.geojson" }
    );
    await page
      .getByTestId("sql-editor")
      .fill("SELECT ST_AsGeoJSON(ST_GeomFromText('LINESTRING (100 364, 300 364)')) AS geometry_geojson");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByTestId("query-status")).toHaveText("success", { timeout: 30_000 });
    const temporaryRow = page.locator('tbody tr[data-query-selection="temporary"]');
    await expect(temporaryRow).toHaveCount(1);

    await page.getByRole("button", { name: "Measure" }).click();
    // Both strokes are within tolerance: persistent is visibly painted 2px away,
    // while the frontmost temporary stroke contributes only its invisible 14px halo.
    await page.mouse.click(box.x + 200, box.y + 352);
    await expect(page.getByTestId("selection-status")).toHaveText("選択: 1件 (persistent:wide-persistent)");
    await expect(temporaryRow).not.toHaveAttribute("data-selected", "true");
  });

  test("同順位の線の輪郭はpolygonの塗りより手前の表示対象として選択する", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    await importFeatures(
      page,
      [
        lineFeature(
          "same-rank-line",
          [
            [100, 200],
            [300, 200],
          ],
          8
        ),
        polygonFeature(
          "same-rank-polygon",
          [
            [100, 100],
            [300, 100],
            [300, 300],
            [100, 300],
            [100, 100],
          ],
          8
        ),
      ],
      { fileName: "selection-elements.geojson" }
    );
    await expect(page.locator(".layer-item__count")).toHaveText("2");
    await page.getByRole("button", { name: "Measure" }).click();
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(page.getByTestId("selection-status")).toHaveText("選択: 1件 (persistent:same-rank-line)");
  });

  test("選択中polygonの内部より同layerの線を手前の表示対象として選択する", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);
    await expect(page.locator(".layer-item__count")).toHaveText("0");
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    await importFeatures(
      page,
      [
        lineFeature(
          "interior-line",
          [
            [100, 200],
            [300, 200],
          ],
          8
        ),
        polygonFeature(
          "selected-polygon",
          [
            [100, 100],
            [300, 100],
            [300, 300],
            [100, 300],
            [100, 100],
          ],
          8
        ),
      ],
      { fileName: "selected-polygon-interior.geojson" }
    );
    await expect(page.locator(".layer-item__count")).toHaveText("2");
    const status = page.getByTestId("selection-status");
    await page.getByRole("button", { name: "Measure" }).click();
    await page.mouse.click(box.x + 200, box.y + 150);
    await expect(status).toHaveText("選択: 1件 (persistent:selected-polygon)");

    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(status).toHaveText("選択: 1件 (persistent:interior-line)");
  });

  test("可視strokeを別layerの見えない選択余白より優先し、余白単独なら選択できる", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    const frontLayer: GeoJSONLayer = {
      id: "front-layer",
      name: "Front",
      visible: true,
      order: 0,
      createdAt: "2026-09-22T00:00:00.000Z",
    };
    const backLayer: GeoJSONLayer = {
      id: "back-layer",
      name: "Back",
      visible: true,
      order: 1,
      createdAt: "2026-09-22T00:00:01.000Z",
    };
    await importFeatures(
      page,
      [
        lineFeature(
          "front-halo-line",
          [
            [100, 200],
            [300, 200],
          ],
          4,
          frontLayer.id
        ),
        lineFeature(
          "back-visible-line",
          [
            [100, 210],
            [300, 210],
          ],
          4,
          backLayer.id
        ),
      ],
      { fileName: "cross-layer-selection-halo.geojson", layers: [frontLayer, backLayer] }
    );

    const status = page.getByTestId("selection-status");
    await page.getByRole("button", { name: "Measure" }).click();
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(status).toHaveText("選択: 1件 (persistent:front-halo-line)");

    // 10px from the selected front stroke is outside its 8px painted outline,
    // but inside its 14px accessibility halo. The visibly painted back stroke wins.
    await page.mouse.click(box.x + 200, box.y + 210);
    await expect(status).toHaveText("選択: 1件 (persistent:back-visible-line)");

    // With no painted candidate at this point, the now-selected back stroke's
    // 14px halo remains available as the accessibility fallback.
    await page.mouse.click(box.x + 200, box.y + 224);
    await expect(status).toHaveText("選択: 1件 (persistent:back-visible-line)");
  });

  test("選択で拡張された太線の可視外縁をクリックしても選択を維持する", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);
    await expect(page.locator(".layer-item__count")).toHaveText("0");
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    await importFeatures(
      page,
      [
        lineFeature(
          "selected-wide-line",
          [
            [100, 200],
            [300, 200],
          ],
          40
        ),
      ],
      { fileName: "selected-wide-line.geojson" }
    );
    await expect(page.locator(".layer-item__count")).toHaveText("1");
    await page.getByRole("button", { name: "Measure" }).click();
    const status = page.getByTestId("selection-status");
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(status).toHaveText("選択: 1件 (persistent:selected-wide-line)");

    // A selected 40px stroke is rendered at 44px. At 21px from its center,
    // the click is outside the original stroke but inside the visible selected edge.
    await page.mouse.click(box.x + 200, box.y + 221);
    await expect(status).toHaveText("選択: 1件 (persistent:selected-wide-line)");
  });

  test("zoom out後も可視範囲の外周クリックで選択解除できる", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "Selection coordinates target a PC-sized viewport");
    test.setTimeout(120_000);
    await gotoApp(page);
    await clearFeatures(page);
    const canvas = page.getByTestId("drawing-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("drawing canvas bounding box was not available");
    await importFeatures(
      page,
      [
        lineFeature(
          "zoom-target",
          [
            [100, 200],
            [300, 200],
          ],
          8
        ),
      ],
      { fileName: "selection-zoom-out.geojson" }
    );
    await expect(page.locator(".layer-item__count")).toHaveText("1");
    await page.getByRole("button", { name: "Measure" }).click();
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(page.getByTestId("selection-status")).toHaveText("選択: 1件 (persistent:zoom-target)");

    await page.getByRole("button", { name: "Pan" }).click();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.65, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, 500);
    await expect
      .poll(async () => {
        const viewportState = await page.evaluate(() => {
          const value = localStorage.getItem("vite-react-three:viewport");
          return value ? (JSON.parse(value) as { zoom?: number }).zoom : undefined;
        });
        return viewportState;
      })
      .toBeLessThan(1);
    await page.getByRole("button", { name: "Measure" }).click();
    await page.mouse.click(box.x + box.width - 30, box.y + 30);
    await expect(page.getByTestId("selection-status")).toHaveText("選択: 0件");
  });
});
