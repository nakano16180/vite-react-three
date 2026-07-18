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
  test("renders the app shell and drawing canvas", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId("app-header")).toContainText("DuckDB Spatial");
    await expect(page.getByRole("button", { name: "Draw" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("drawing-canvas")).toBeVisible();
    await expect(page.getByTestId("status-footer")).toContainText("Draw モード");
  });

  test("focuses the workspace on DuckDB spatial drawing controls", async ({ page }) => {
    await gotoApp(page);

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
});
