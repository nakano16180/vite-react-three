import { expect, type Page, test } from "@playwright/test";

const attributeFixture = {
  type: "FeatureCollection",
  workbench: {
    layers: [
      {
        id: "default",
        name: "Default",
        visible: true,
        order: 0,
        createdAt: "1970-01-01T00:00:00.000Z",
      },
      {
        id: "attributes",
        name: "Attributes",
        visible: true,
        order: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
  features: [
    {
      type: "Feature",
      id: "attr-a",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [20, 0],
        ],
      },
      properties: { name: "Alpha", score: 2, active: true, nested: { level: 1 }, empty: null },
      workbench: {
        layerId: "attributes",
        style: { strokeColor: "#222222", strokeWidth: 4 },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      type: "Feature",
      id: "attr-b",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 10],
          [20, 10],
        ],
      },
      properties: { name: "Beta", score: 10, active: false, nested: { level: 2 }, empty: null },
      workbench: {
        layerId: "attributes",
        style: { strokeColor: "#222222", strokeWidth: 4 },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ],
};

const gotoApp = async (page: Page) => {
  await page.goto("./");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
};

test("active layerの属性をsort/filter/editしてrefreshとreload後も保持する", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await page.getByRole("button", { name: "Clear" }).click();

  await page.locator("#geojson-file-input").setInputFiles({
    name: "attributes.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(attributeFixture)),
  });
  const attributesRadio = page.getByRole("radio", { name: "Set Attributes as active layer" });
  await expect(attributesRadio).toBeEnabled({ timeout: 30_000 });
  await attributesRadio.click();
  await expect(attributesRadio).toBeChecked({ timeout: 30_000 });

  const table = page.getByTestId("attribute-table");
  await expect(page.getByTestId("storage-status")).toContainText("Spatial");
  await expect(table).toContainText("attr-a");
  await expect(table).toContainText("attr-b");
  await expect(table.getByRole("columnheader", { name: "geometry" })).toHaveCount(0);

  await expect(table.getByRole("columnheader", { name: "score" })).toHaveAttribute("aria-sort", "none");
  await table.getByRole("button", { name: "Sort by score" }).click();
  await expect(table.getByRole("columnheader", { name: "score" })).toHaveAttribute("aria-sort", "ascending");
  const rows = table.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("attr-a");
  await expect(rows.nth(1)).toContainText("attr-b");

  await table.getByLabel("Filter name").fill("alpha");
  await expect(page.getByTestId("attribute-row-count")).toHaveText("1 / 2 rows");
  await expect(rows).toHaveCount(1);

  await expect(table.getByRole("button", { name: "Edit score for attr-a" })).toBeVisible();
  await table.getByRole("button", { name: "Edit score for attr-a" }).click();
  await table.getByLabel("Edit score for attr-a").fill("{");
  await table.getByRole("button", { name: "Save" }).click();
  await expect(table.getByRole("alert")).toContainText("valid JSON");
  await table.getByLabel("Edit score for attr-a").fill("5");
  await table.getByRole("button", { name: "Save" }).click();
  await expect(table.getByTitle("Edit score")).toHaveText("5");

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(table.getByTitle("Edit score")).toHaveText("5");
  await page.reload();
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(attributesRadio).toBeEnabled({ timeout: 30_000 });
  await attributesRadio.click();
  await expect(attributesRadio).toBeChecked({ timeout: 30_000 });
  await expect(
    page.getByTestId("attribute-table").locator("tbody tr").filter({ hasText: "attr-a" }).getByTitle("Edit score")
  ).toHaveText("5");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GeoJSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("GeoJSON export stream was not available");
  let exportedText = "";
  for await (const chunk of stream) exportedText += chunk.toString();
  const exported = JSON.parse(exportedText) as {
    features: Array<{ id: string; properties: Record<string, unknown> }>;
  };
  expect(exported.features.find(({ id }) => id === "attr-a")?.properties).toEqual({
    name: "Alpha",
    score: 5,
    active: true,
    nested: { level: 1 },
    empty: null,
  });
});
