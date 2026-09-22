import { describe, expect, it } from "vitest";
import { createGeometryFeature, DEFAULT_LAYER_ID, type JsonValue } from "../domain/geometryFeature";
import {
  attributeDisplayValue,
  attributeEditorValue,
  attributeKeys,
  attributePropertyColumnKey,
  filterAndSortFeatures,
  isJsonValue,
  parseAttributeValue,
} from "./attributeTable";

const feature = (id: string, properties: Record<string, JsonValue>) =>
  createGeometryFeature({
    id,
    layerId: DEFAULT_LAYER_ID,
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties,
  });

describe("attribute table helpers", () => {
  it("creates a sorted property union and stable JSON display/editor values", () => {
    const features = [feature("b", { score: 2, name: "B" }), feature("a", { active: true, score: null })];

    expect(attributeKeys(features)).toEqual(["active", "name", "score"]);
    expect(attributeDisplayValue({ nested: [1, true] })).toBe('{"nested":[1,true]}');
    expect(attributeEditorValue("quoted")).toBe('"quoted"');
  });

  it("sorts typed values and combines filters with AND", () => {
    const features = [
      feature("one", { score: 10, name: "Road" }),
      feature("two", { score: 2, name: "Roadside" }),
      feature("three", { score: null, name: "Path" }),
    ];

    expect(filterAndSortFeatures(features, {}, { key: "score", direction: "ascending" }).map(({ id }) => id)).toEqual([
      "three",
      "two",
      "one",
    ]);
    expect(filterAndSortFeatures(features, { name: "road", score: "2" }).map(({ id }) => id)).toEqual(["two"]);
  });

  it("keeps a user property named id separate from the canonical feature ID", () => {
    const features = [feature("feature-id", { id: "user-id", score: 1 })];

    expect(attributePropertyColumnKey("id")).toBe("property:id");
    expect(filterAndSortFeatures(features, { "property:id": "user-id" })).toHaveLength(1);
    expect(filterAndSortFeatures(features, {}, { key: "property:id", direction: "ascending" })).toEqual(features);
  });

  it("accepts every JSON value but rejects non-finite values nested in a JSON document", () => {
    expect(parseAttributeValue(' {"ok":[null,false,2,"text"]} ')).toEqual({
      ok: [null, false, 2, "text"],
    });
    expect(() => parseAttributeValue("[1e999]")).toThrow("JSON-safe");
    expect(isJsonValue({ ok: true })).toBe(true);
    expect(isJsonValue({ bad: Infinity })).toBe(false);
  });
});
