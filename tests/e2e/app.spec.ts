import { expect, type Page, test } from "@playwright/test";

const gotoApp = async (page: Page) => {
  await page.goto("./");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
};

const getCanvasBox = async (page: Page) => {
  const canvas = page.getByTestId("drawing-canvas");
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("drawing canvas bounding box was not available");
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(100);

  return box;
};

const exportFeatureCount = async (page: Page) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GeoJSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  const collection = JSON.parse(text) as { features: unknown[] };
  return collection.features.length;
};

test.describe("drawing workspace", () => {
  test.describe.configure({ mode: "serial" });

  test("DuckDB初期化中はGeoJSON exportを無効にする", async ({ page }) => {
    await page.goto("./", { waitUntil: "domcontentloaded" });

    const exportButton = page.getByRole("button", { name: "Export GeoJSON" });
    await expect(exportButton).toBeDisabled();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await expect(exportButton).toBeEnabled();
  });

  test("renders the app shell and drawing canvas", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Clear" }).click();

    await expect(page.getByTestId("app-header")).toContainText("DuckDB Spatial");
    await expect(page.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("drawing-canvas")).toBeVisible();
    await expect(page.getByTestId("status-footer")).toContainText("Draw モード");
    await expect(page.getByTestId("storage-status")).toContainText(/OPFS|メモリ/);
    await expect(page.getByTestId("storage-status")).toContainText(/Spatial|JSON fallback/);
  });

  test("focuses the workspace on DuckDB spatial drawing controls", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Clear" }).click();

    await expect(page.getByRole("button", { name: "Show Map" })).toHaveCount(0);
    await expect(page.getByText("Load PCD")).toHaveCount(0);
    await expect(page.getByText("Clear PCD")).toHaveCount(0);
  });

  test("draws a line and shows its measurement", async ({ page }) => {
    await gotoApp(page);

    const box = await getCanvasBox(page);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Draw" }).click();

    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.35);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByRole("button", { name: "Measure" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Length: \d+\.\d px/)).toBeVisible({ timeout: 10_000 });
  });

  test("保存したlineをrefreshとreload後に復元する", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoApp(page);
    const box = await getCanvasBox(page);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.mouse.click(box.x + 100, box.y + 100);
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText("Length: 161.2 px")).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Length: 161.2 px")).toBeVisible();

    const status = page.getByTestId("storage-status");
    await expect(status).toContainText("OPFS");
    await page.reload();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText("Length: 161.2 px")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(0);
  });

  test("編集したlineをrefreshとreload後に復元する", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoApp(page);
    const box = await getCanvasBox(page);
    await page.getByRole("button", { name: "Clear" }).click();

    const start = { x: box.x + 100, y: box.y + 100 };
    const originalEnd = { x: box.x + 240, y: box.y + 180 };
    const editedEnd = { x: box.x + 300, y: box.y + 180 };
    await page.mouse.click(start.x, start.y);
    await page.mouse.click(originalEnd.x, originalEnd.y);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText("Length: 161.2 px")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.mouse.move(originalEnd.x, originalEnd.y);
    await page.mouse.down();
    await page.mouse.move(editedEnd.x, editedEnd.y, { steps: 8 });
    await page.mouse.up();

    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText("Length: 215.4 px")).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Length: 215.4 px")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText("Length: 215.4 px")).toBeVisible();
  });

  test("Pan後の座標とviewportをreload後も保持する", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoApp(page);
    const box = await getCanvasBox(page);
    await page.getByRole("button", { name: "Clear" }).click();

    await page.mouse.click(box.x + 100, box.y + 100);
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Measure" }).click();

    const measurement = page.getByText("Length: 161.2 px");
    await expect(measurement).toBeVisible();
    const beforePan = await measurement.boundingBox();
    if (!beforePan) throw new Error("measurement bounding box was not available before pan");

    await page.getByRole("button", { name: "Pan" }).click();
    await expect(page.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();

    await page.getByRole("button", { name: "Measure" }).click();
    await expect(measurement).toBeVisible();
    const afterPan = await measurement.boundingBox();
    if (!afterPan) throw new Error("measurement bounding box was not available after pan");
    expect(Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y)).toBeGreaterThan(20);

    const pannedStart = { x: box.x + 100, y: box.y + 100 };
    const pannedEnd = { x: box.x + 260, y: box.y + 180 };
    await page.getByRole("button", { name: "Draw" }).click();
    await page.mouse.click(pannedStart.x, pannedStart.y);
    await page.mouse.click(pannedEnd.x, pannedEnd.y);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Measure" }).click();
    const pannedMeasurement = page.getByText("Length: 178.9 px");
    await expect(pannedMeasurement).toBeVisible();
    const afterDraw = await pannedMeasurement.boundingBox();
    if (!afterDraw) throw new Error("panned measurement bounding box was not available before reload");

    expect(await exportFeatureCount(page)).toBe(2);

    await page.reload();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Measure" }).click();
    await expect(pannedMeasurement).toBeVisible();
    const afterReload = await pannedMeasurement.boundingBox();
    if (!afterReload) throw new Error("measurement bounding box was not available after reload");
    expect(Math.hypot(afterReload.x - afterDraw.x, afterReload.y - afterDraw.y)).toBeLessThanOrEqual(2);
  });

  test("Clearしたgeometryはrefreshとreload後にも復元されない", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoApp(page);
    const box = await getCanvasBox(page);
    await page.getByRole("button", { name: "Clear" }).click();

    await page.mouse.click(box.x + 100, box.y + 100);
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText("Length: 161.2 px")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Measure" }).click();
    await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(0);
  });
});
