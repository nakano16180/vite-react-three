import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const exportGeoJSON = async (page: Page) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GeoJSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  return JSON.parse(text) as {
    features: Array<{
      id: string;
      geometry: { type: string };
      properties: Record<string, unknown>;
      workbench: Record<string, unknown>;
    }>;
  };
};

test("GeoJSON import/exportでgeometry typeとpropertiesを保持する", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Clear" }).click();
  await page.locator("#geojson-file-input").setInputFiles(path.resolve("tests/fixtures/features.geojson"));
  await page.getByRole("button", { name: "Measure" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toBeVisible();

  const exported = await exportGeoJSON(page);

  expect(exported.features).toHaveLength(1);
  expect(exported.features[0]).toMatchObject({
    id: "fixture-line",
    geometry: { type: "LineString" },
    properties: { name: "Fixture road", rank: 2 },
    workbench: {
      style: { strokeColor: "#e11d48", strokeWidth: 5 },
      layerId: "default",
    },
  });
});

test("Undoはcanonical createdAtではなく直近のimportを削除する", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Clear" }).click();

  const canvas = page.getByTestId("drawing-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("drawing canvas bounding box was not available");
  await page.mouse.click(box.x + 40, box.y + 40);
  await page.mouse.click(box.x + 120, box.y + 80);
  await page.keyboard.press("Escape");

  await page.locator("#geojson-file-input").setInputFiles(path.resolve("tests/fixtures/features.geojson"));
  await page.getByRole("button", { name: "Measure" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(2);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toHaveCount(1);

  const exported = await exportGeoJSON(page);
  expect(exported.features).toHaveLength(1);
  expect(exported.features[0].id).not.toBe("fixture-line");
});
