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

test.describe("drawing workspace", () => {
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
});
