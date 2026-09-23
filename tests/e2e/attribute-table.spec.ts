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
      properties: {
        id: "user-z",
        "properties.id": "qualified-a",
        name: "Alpha",
        score: 2,
        active: true,
        nested: { level: 1 },
        empty: null,
      },
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
      properties: {
        id: "user-a",
        "properties.id": "qualified-b",
        name: "Beta",
        score: 10,
        active: false,
        nested: { level: 2 },
        empty: null,
      },
      workbench: {
        layerId: "attributes",
        style: { strokeColor: "#222222", strokeWidth: 4 },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ],
};

const defaultDraftFixture = {
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
    ],
  },
  features: [
    {
      type: "Feature",
      id: "draft-feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [20, 0],
        ],
      },
      properties: { score: 2 },
      workbench: {
        layerId: "default",
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
  await expect(table.getByRole("columnheader", { name: "Feature ID" })).toHaveCount(1);
  await expect(table.getByRole("columnheader", { name: "property: id" })).toHaveCount(1);
  await expect(table.getByRole("columnheader", { name: "property: properties.id" })).toHaveCount(1);

  await table.getByRole("button", { name: "Sort by Feature ID" }).click();
  await expect(table.getByRole("columnheader", { name: "Feature ID" })).toHaveAttribute("aria-sort", "ascending");
  await table.getByLabel("Filter Feature ID").fill("attr-a");
  await expect(page.getByTestId("attribute-row-count")).toHaveText("1 / 2 rows");
  await table.getByLabel("Filter Feature ID").fill("");

  await table.getByRole("button", { name: "Sort by property: id" }).click();
  await expect(table.getByRole("columnheader", { name: "property: id" })).toHaveAttribute("aria-sort", "ascending");
  await expect(table.locator("tbody tr").nth(0)).toContainText("attr-b");
  await table.getByLabel("Filter property: id").fill("user-z");
  await expect(page.getByTestId("attribute-row-count")).toHaveText("1 / 2 rows");
  await table.getByLabel("Filter property: id").fill("");
  await expect(table.getByRole("button", { name: "Sort by property: properties.id" })).toBeVisible();
  await expect(table.getByLabel("Filter property: properties.id")).toBeVisible();

  await expect(table.getByRole("columnheader", { name: "property: score" })).toHaveAttribute("aria-sort", "none");
  await table.getByRole("button", { name: "Sort by property: score" }).click();
  await expect(table.getByRole("columnheader", { name: "property: score" })).toHaveAttribute("aria-sort", "ascending");
  const rows = table.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("attr-a");
  await expect(rows.nth(1)).toContainText("attr-b");

  await table.getByLabel("Filter property: name").fill("alpha");
  await expect(page.getByTestId("attribute-row-count")).toHaveText("1 / 2 rows");
  await expect(rows).toHaveCount(1);

  await expect(table.getByRole("button", { name: "Edit property: id for attr-a" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Edit property: properties.id for attr-a" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Edit property: score for attr-a" })).toBeVisible();
  await table.getByRole("button", { name: "Edit property: score for attr-a" }).click();
  await table.getByLabel("Edit property: score for attr-a").fill("{");
  await table.getByRole("button", { name: "Save" }).click();
  await expect(table.getByRole("alert")).toContainText("valid JSON");
  await table.getByLabel("Edit property: score for attr-a").fill("5");
  await table.getByRole("button", { name: "Save" }).click();
  await expect(table.getByTitle("Edit property: score")).toHaveText("5");

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(table.getByTitle("Edit property: score")).toHaveText("5");
  await page.reload();
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await expect(attributesRadio).toBeEnabled({ timeout: 30_000 });
  await attributesRadio.click();
  await expect(attributesRadio).toBeChecked({ timeout: 30_000 });
  await expect(
    page
      .getByTestId("attribute-table")
      .locator("tbody tr")
      .filter({ hasText: "attr-a" })
      .getByTitle("Edit property: score")
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
    id: "user-z",
    "properties.id": "qualified-a",
    score: 5,
    active: true,
    nested: { level: 1 },
    empty: null,
  });
});

test("attribute editorのEscapeはDraw中の未完strokeを確定しない", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await page.getByRole("button", { name: "Clear" }).click();
  await page.locator("#geojson-file-input").setInputFiles({
    name: "default-draft.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(defaultDraftFixture)),
  });

  const table = page.getByTestId("attribute-table");
  await expect(table.getByRole("button", { name: "Edit property: score for draft-feature" })).toBeVisible();
  const canvas = page.getByTestId("drawing-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("drawing canvas bounding box was not available");
  await page.getByRole("button", { name: "Draw" }).click();
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.click(box.x + 240, box.y + 180);

  await table.getByRole("button", { name: "Edit property: score for draft-feature" }).click();
  await table.getByLabel("Edit property: score for draft-feature").fill("8");
  await page.keyboard.press("Escape");
  await expect(table.getByRole("button", { name: "Edit property: score for draft-feature" })).toBeVisible();
  await expect(page.getByTestId("attribute-row-count")).toHaveText("1 / 1 rows");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("attribute-row-count")).toHaveText("2 / 2 rows", { timeout: 10_000 });
});

test("Clear後に同じfeatureを再importしても古いproperty draftを復活させない", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await page.getByRole("button", { name: "Clear" }).click();
  const importDraft = async () =>
    page.locator("#geojson-file-input").setInputFiles({
      name: "default-draft.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify(defaultDraftFixture)),
    });
  await importDraft();

  const table = page.getByTestId("attribute-table");
  await table.getByRole("button", { name: "Edit property: score for draft-feature" }).click();
  await table.getByLabel("Edit property: score for draft-feature").fill("999");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("attribute-row-count")).toHaveText("0 / 0 rows");

  await importDraft();
  await expect(table.getByRole("button", { name: "Edit property: score for draft-feature" })).toBeVisible();
  await table.getByRole("button", { name: "Edit property: score for draft-feature" }).click();
  await expect(table.getByLabel("Edit property: score for draft-feature")).toHaveValue("2");
});
