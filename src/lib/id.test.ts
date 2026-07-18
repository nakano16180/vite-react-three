import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeometryFeature, type FeatureGeometry } from "../domain/geometryFeature";
import { importFeatureCollection } from "./geojson";
import { createId } from "./id";

const geometry: FeatureGeometry = {
  type: "LineString",
  coordinates: [
    [0, 0],
    [1, 1],
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createId", () => {
  it("randomUUIDが利用可能な場合はその値を使う", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "uuid-value") });

    expect(createId()).toBe("uuid-value");
  });

  it("randomUUIDが利用できない場合も空でないIDを生成する", () => {
    vi.stubGlobal("crypto", {});

    expect(createId()).toMatch(/^feature-/);
  });

  it("randomUUIDなしでもcanonical featureを作成する", () => {
    vi.stubGlobal("crypto", {});

    expect(createGeometryFeature({ geometry }).id).toMatch(/^feature-/);
  });

  it("randomUUIDなしでもIDのないGeoJSON featureをimportする", () => {
    vi.stubGlobal("crypto", {});

    const imported = importFeatureCollection({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry, properties: {} }],
    });

    expect(imported.features[0].id).toMatch(/^feature-/);
  });
});
