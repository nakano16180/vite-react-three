import path from "node:path";
import { expect, test } from "@playwright/test";

test("GeoJSON import/exportでgeometry typeとpropertiesを保持する", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Clear" }).click();
  await page.locator("#geojson-file-input").setInputFiles(path.resolve("tests/fixtures/features.geojson"));
  await page.getByRole("button", { name: "Measure" }).click();
  await expect(page.getByText(/Length: \d+\.\d px/)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GeoJSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  const exported = JSON.parse(text);

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
