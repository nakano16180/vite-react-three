import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER_ID } from "../domain/geometryFeature";
import { mapJsonFeatureRow, mapLegacyJsonRow } from "./geometryRepository";

describe("geometry repository row mapping", () => {
  it("JSON store rowをcanonical featureへ変換する", () => {
    const feature = mapJsonFeatureRow({
      id: "line-1",
      geom_type: "LineString",
      coordinates: "[[0,0],[2,2]]",
      properties: '{"name":"a"}',
      style: '{"strokeColor":"#123456","strokeWidth":5}',
      layer_id: DEFAULT_LAYER_ID,
      created_at: "2026-07-18T00:00:00.000Z",
    });
    expect(feature).toMatchObject({ id: "line-1", properties: { name: "a" } });
  });

  it("legacy JSON rowをDefault layerへ変換する", () => {
    const feature = mapLegacyJsonRow({
      id: "legacy-1",
      coords: "[[0,0],[2,2]]",
      color: "#abcdef",
      width: 6,
      geom_type: "line",
      created_at: "2026-07-18T00:00:00.000Z",
    });
    expect(feature).toMatchObject({
      id: "legacy-1",
      layerId: DEFAULT_LAYER_ID,
      properties: {},
      style: { strokeColor: "#abcdef", strokeWidth: 6 },
    });
  });
});
