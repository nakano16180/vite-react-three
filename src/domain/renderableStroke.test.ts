import { describe, expect, it } from "vitest";
import { createGeometryFeature, type FeatureGeometry } from "./geometryFeature";
import { simplifyFeatureGeometry, toRenderableStroke } from "./renderableStroke";

describe("toRenderableStroke", () => {
  it("canonical Polygonを計測値つきRenderableStrokeへ変換する", () => {
    const stroke = toRenderableStroke(
      createGeometryFeature({
        id: "polygon-1",
        geometry: {
          type: "Polygon",
          coordinates: [
            [0, 0],
            [4, 0],
            [4, 3],
          ],
        },
        style: { strokeColor: "#ff0000", strokeWidth: 2 },
      })
    );

    expect(stroke).toMatchObject({
      id: "polygon-1",
      color: "#ff0000",
      width: 2,
      geomType: "polygon",
      area: 6,
      perimeter: 12,
    });
  });
});

describe("simplifyFeatureGeometry", () => {
  it("toleranceが0以下なら座標値のcopyを返す", () => {
    const geometry: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    };

    const simplified = simplifyFeatureGeometry(geometry, 0);

    expect(simplified).toEqual(geometry);
    expect(simplified).not.toBe(geometry);
    expect(simplified.coordinates).not.toBe(geometry.coordinates);
    expect(simplified.coordinates[0]).not.toBe(geometry.coordinates[0]);
  });

  it("Douglas-Peucker法でLineStringの中間点を削減する", () => {
    const geometry: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 0.1],
        [2, 0],
      ],
    };

    expect(simplifyFeatureGeometry(geometry, 0.2)).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [2, 0],
      ],
    });
  });

  it("Polygonを開いたringのまま最低3点に維持する", () => {
    const geometry: FeatureGeometry = {
      type: "Polygon",
      coordinates: [
        [0, 0],
        [1, 0.01],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    };

    const simplified = simplifyFeatureGeometry(geometry, 100);

    expect(simplified.type).toBe("Polygon");
    expect(simplified.coordinates).toHaveLength(3);
    expect(simplified.coordinates[0]).not.toEqual(simplified.coordinates.at(-1));
  });
});
