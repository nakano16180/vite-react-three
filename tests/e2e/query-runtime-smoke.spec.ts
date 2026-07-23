import { expect, test } from "@playwright/test";

test("query sandbox executes SELECT and rejects writes in a real browser", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 30_000 });

  const result = await page.evaluate(async () => {
    const { QueryRejectedError, createQueryRuntime } = await import("/vite-react-three/src/db/queryRuntime.ts");
    const runtime = await createQueryRuntime({
      features: [
        {
          id: "browser-feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [3, 4],
            ],
          },
          properties: { source: "browser-smoke" },
          style: { strokeColor: "#112233", strokeWidth: 2 },
          layerId: "browser-layer",
          createdAt: "2026-07-24T00:00:00.000Z",
        },
      ],
      layers: [
        {
          id: "browser-layer",
          name: "Browser",
          visible: true,
          order: 0,
          createdAt: "2026-07-24T00:00:00.000Z",
        },
      ],
    });
    try {
      const query = await runtime.execute(
        "SELECT id, geometry_type, geometry_geojson FROM geometry_features ORDER BY feature_order"
      );
      let rejected = false;
      try {
        await runtime.execute("DELETE FROM geometry_features");
      } catch (error) {
        rejected = error instanceof QueryRejectedError;
      }
      return { query, rejected };
    } finally {
      await runtime.dispose();
    }
  });

  expect(result.rejected).toBe(true);
  expect(result.query).toMatchObject({
    status: "success",
    rowCount: 1,
    truncated: false,
    rows: [
      {
        id: "browser-feature",
        geometry_type: "LineString",
      },
    ],
  });
});
