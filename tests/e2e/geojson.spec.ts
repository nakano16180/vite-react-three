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

test("layer panelのactive・visibility・order・rename・deleteを永続化する", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Layer panel targets PC-sized browser viewports");
  test.setTimeout(90_000);
  await page.goto("./");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Clear" }).click();

  const collection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "layer-panel-line",
        geometry: {
          type: "LineString",
          coordinates: [
            [100, 100],
            [240, 180],
          ],
        },
        properties: {},
        workbench: {
          style: { strokeColor: "#e11d48", strokeWidth: 5 },
          layerId: "roads",
          createdAt: "2026-08-29T00:00:00.000Z",
        },
      },
    ],
    workbench: {
      layers: [
        {
          id: "roads",
          name: "Roads",
          visible: true,
          order: 1,
          createdAt: "2026-08-29T00:00:00.000Z",
        },
      ],
    },
  };
  await page.locator("#geojson-file-input").setInputFiles({
    name: "layers.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(collection)),
  });

  await page.getByRole("radio", { name: "Set Roads as active layer" }).click();
  await expect(page.getByRole("radio", { name: "Set Roads as active layer" })).toBeChecked();
  await page.getByRole("button", { name: "Roads", exact: true }).click();
  await page.getByRole("textbox", { name: "Layer name" }).fill("Transport");
  await page.getByRole("textbox", { name: "Layer name" }).press("Enter");
  await expect(page.getByRole("button", { name: "Transport", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move Transport up" }).click();
  await expect(page.locator(".layer-item__name").first()).toHaveText("Transport");
  await page.getByRole("checkbox", { name: "Show Transport" }).click();
  await expect(page.getByRole("checkbox", { name: "Show Transport" })).not.toBeChecked();

  await page.reload();
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("radio", { name: "Set Transport as active layer" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Show Transport" })).not.toBeChecked();
  const layerNames = page.locator(".layer-item__name");
  await expect(layerNames.first()).toHaveText("Transport");

  const canvas = page.getByTestId("drawing-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("drawing canvas bounding box was not available");
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.mouse.click(box.x + 160, box.y + 100);
  await page.keyboard.press("Escape");
  const exported = await exportGeoJSON(page);
  expect(exported.features).toHaveLength(2);
  expect(exported.features.every((feature) => feature.workbench.layerId === "roads")).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".layer-item")
    .filter({ has: page.getByRole("button", { name: "Transport", exact: true }) })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("button", { name: "Transport", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Set Default as active layer" })).toBeChecked();
  expect((await exportGeoJSON(page)).features).toHaveLength(0);
});
