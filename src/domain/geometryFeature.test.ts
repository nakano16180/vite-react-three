import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER_ID, createDefaultStyle, createGeometryFeature, isFeatureGeometry } from "./geometryFeature";

describe("canonical feature model", () => {
  it("default layerとstyleを設定してfeatureを作る", () => {
    const feature = createGeometryFeature({
      id: "line-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [10, 10],
        ],
      },
      createdAt: "2026-07-18T00:00:00.000Z",
    });
    expect(feature).toMatchObject({
      id: "line-1",
      properties: {},
      layerId: DEFAULT_LAYER_ID,
      style: createDefaultStyle(),
    });
  });

  it("Polygonの重複終点をcanonical formから除く", () => {
    const feature = createGeometryFeature({
      geometry: {
        type: "Polygon",
        coordinates: [
          [0, 0],
          [10, 0],
          [0, 10],
          [0, 0],
        ],
      },
    });
    expect(feature.geometry.coordinates).toEqual([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);
  });

  it("有限値でない座標と点不足を拒否する", () => {
    expect(isFeatureGeometry({ type: "LineString", coordinates: [[0, 0]] })).toBe(false);
    expect(
      isFeatureGeometry({
        type: "Polygon",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      })
    ).toBe(false);
    expect(
      isFeatureGeometry({
        type: "LineString",
        coordinates: [
          [0, Number.NaN],
          [1, 1],
        ],
      })
    ).toBe(false);
  });
});
