import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER, createGeometryFeature } from "../domain/geometryFeature";
import { exportFeatureCollection, importFeatureCollection } from "./geojson";

describe("GeoJSON codec", () => {
  it("canonical fieldをLineStringでround-tripする", () => {
    const feature = createGeometryFeature({
      id: "line-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
      properties: { name: "road", nested: { rank: 2 } },
      style: { strokeColor: "#ff0000", strokeWidth: 7 },
      createdAt: "2026-07-18T00:00:00.000Z",
    });
    const imported = importFeatureCollection(exportFeatureCollection([feature], [DEFAULT_LAYER]));
    expect(imported.warnings).toEqual([]);
    expect(imported.features[0]).toEqual(feature);
    expect(imported.layers).toEqual([DEFAULT_LAYER]);
  });

  it("Polygon ringをexport時に閉じ、import時に開く", () => {
    const feature = createGeometryFeature({
      id: "polygon-1",
      geometry: {
        type: "Polygon",
        coordinates: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
      },
    });
    const exported = exportFeatureCollection([feature], [DEFAULT_LAYER]);
    expect(exported.features[0].geometry.coordinates).toEqual([
      [
        [0, 0],
        [10, 0],
        [0, 10],
        [0, 0],
      ],
    ]);
    expect(importFeatureCollection(exported).features[0].geometry.coordinates).toEqual([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);
  });

  it("legacy propertiesをstyleへ変換しreserved fieldを除く", () => {
    const imported = importFeatureCollection({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: { id: "legacy-1", color: "#00ff00", width: 3, geomType: "line", label: "kept" },
    });
    expect(imported.features[0]).toMatchObject({
      id: "legacy-1",
      properties: { label: "kept" },
      style: { strokeColor: "#00ff00", strokeWidth: 3 },
    });
  });

  it("不正なFeatureCollectionと非対応geometryをwarning付きでskipする", () => {
    expect(importFeatureCollection({ type: "FeatureCollection", features: "invalid" })).toMatchObject({
      features: [],
      warnings: [expect.any(String)],
    });

    const imported = importFeatureCollection({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }],
    });
    expect(imported.features).toEqual([]);
    expect(imported.warnings).toHaveLength(1);
  });

  it("閉環除去後に頂点不足となるPolygonをwarning付きでskipする", () => {
    const imported = importFeatureCollection({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          id: "valid-line",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: {},
        },
      ],
    });

    expect(imported.features).toHaveLength(1);
    expect(imported.features[0].id).toBe("valid-line");
    expect(imported.warnings).toHaveLength(1);
  });

  it("custom layerがあってもfallbackされたDEFAULT_LAYERを返却layersへ追加する", () => {
    const customLayer = { ...DEFAULT_LAYER, id: "custom", name: "Custom" };
    const imported = importFeatureCollection({
      type: "FeatureCollection",
      workbench: { layers: [customLayer] },
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: {},
          workbench: { layerId: "missing" },
        },
      ],
    });

    expect(imported.features[0].layerId).toBe(DEFAULT_LAYER.id);
    expect(imported.layers).toEqual([customLayer, DEFAULT_LAYER]);
  });

  it("__proto__ propertyを通常のJSON dataとして保持する", () => {
    const input = JSON.parse(`{
      "type": "Feature",
      "geometry": { "type": "LineString", "coordinates": [[0, 0], [1, 1]] },
      "properties": { "__proto__": { "safe": true }, "label": "kept" }
    }`) as unknown;
    const properties = importFeatureCollection(input).features[0].properties;

    expect(Object.hasOwn(properties, "__proto__")).toBe(true);
    expect(properties["__proto__"]).toEqual({ safe: true });
    expect(properties.label).toBe("kept");
  });

  it("existingIdsとfile内のID衝突を回避する", () => {
    const imported = importFeatureCollection(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "duplicate",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: {},
          },
          {
            type: "Feature",
            id: "duplicate",
            geometry: {
              type: "LineString",
              coordinates: [
                [1, 1],
                [2, 2],
              ],
            },
            properties: {},
          },
        ],
      },
      new Set(["duplicate"])
    );
    expect(new Set(imported.features.map(({ id }) => id)).size).toBe(2);
    expect(imported.features.every(({ id }) => id !== "duplicate")).toBe(true);
  });

  it("衝突しないIDを保持しlegacy properties.idの衝突も回避する", () => {
    const imported = importFeatureCollection(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "kept",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: {},
          },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [1, 1],
                [2, 2],
              ],
            },
            properties: { id: "legacy-existing" },
          },
        ],
      },
      new Set(["legacy-existing"])
    );

    expect(imported.features[0].id).toBe("kept");
    expect(imported.features[1].id).not.toBe("legacy-existing");
  });

  it("exportでは参照されたlayerだけを保存する", () => {
    const feature = createGeometryFeature({
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    const unusedLayer = { ...DEFAULT_LAYER, id: "unused", name: "Unused" };
    expect(exportFeatureCollection([feature], [DEFAULT_LAYER, unusedLayer]).workbench.layers).toEqual([DEFAULT_LAYER]);
  });
});
