import { describe, expect, it } from "vitest";
import type { QueryResult } from "../db/queryRuntime";
import { queryResultFeatures, queryResultSelectionIdentities, queryResultStrokes } from "./queryResultGeometry";
import { selectionIdentityKey } from "./selection";

const result = (values: unknown[]): QueryResult => ({
  status: "success",
  columns: [{ name: "geometry_geojson", type: "VARCHAR", geometryRole: "geojson" }],
  rows: values.map((value) => ({ geometry_geojson: value })),
  rowCount: values.length,
  truncated: false,
});

describe("query result geometry", () => {
  it("LineStringとclosed Polygonをtemporary strokesへ変換する", () => {
    const strokes = queryResultStrokes(
      result([
        '{"type":"LineString","coordinates":[[0,0],[2,2]]}',
        '{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]}',
      ]),
      4
    );
    expect(strokes.map(({ geomType, ptsPx }) => ({ geomType, ptsPx }))).toEqual([
      {
        geomType: "line",
        ptsPx: [
          [0, 0],
          [2, 2],
        ],
      },
      {
        geomType: "polygon",
        ptsPx: [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
      },
    ]);
    expect(strokes.every(({ renderOrder }) => renderOrder === 4)).toBe(true);
  });

  it("NULL、invalid、unsupported geometryをskipしrows自体は変更しない", () => {
    const queryResult = result([null, "not-json", '{"type":"Point","coordinates":[1,2]}']);
    expect(queryResultStrokes(queryResult)).toEqual([]);
    expect(queryResult.rows).toHaveLength(3);
  });

  it("geometry role列がなければ描画しない", () => {
    expect(queryResultStrokes({ ...result([]), columns: [{ name: "id", type: "VARCHAR" }] })).toEqual([]);
  });

  it("promotion用featureへrow attributes、style、layer membershipを保持しfresh IDsを割り当てる", () => {
    const queryResult: QueryResult = {
      ...result(['{"type":"LineString","coordinates":[[0,0],[2,2]]}']),
      columns: [
        { name: "geometry_geojson", type: "VARCHAR", geometryRole: "geojson" },
        { name: "category", type: "VARCHAR" },
        { name: "score", type: "INTEGER" },
      ],
      rows: [
        {
          geometry_geojson: '{"type":"LineString","coordinates":[[0,0],[2,2]]}',
          category: "road",
          score: 7,
        },
      ],
    };

    const first = queryResultFeatures(queryResult, "analysis-layer")[0];
    const second = queryResultFeatures(queryResult, "analysis-layer")[0];

    expect(first).toMatchObject({
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [2, 2],
        ],
      },
      properties: { category: "road", score: 7 },
      style: { strokeColor: "#ec4899", strokeWidth: 5, fillColor: "#f9a8d4", fillOpacity: 0.18 },
      layerId: "analysis-layer",
    });
    expect(first.id).not.toBe(second.id);
  });

  it("canonical idを持つgeometry rowはpersistent、idなしはqueryごとのtemporary identityになる", () => {
    const queryResult: QueryResult = {
      ...result([
        '{"type":"LineString","coordinates":[[0,0],[2,2]]}',
        '{"type":"LineString","coordinates":[[2,0],[4,2]]}',
      ]),
      columns: [
        { name: "id", type: "VARCHAR" },
        { name: "geometry_geojson", type: "VARCHAR", geometryRole: "geojson" },
      ],
      rows: [
        { id: "feature-1", geometry_geojson: '{"type":"LineString","coordinates":[[0,0],[2,2]]}' },
        { id: "unknown", geometry_geojson: '{"type":"LineString","coordinates":[[2,0],[4,2]]}' },
      ],
    };
    const identities = queryResultSelectionIdentities(queryResult, "query-4", new Set(["feature-1"]));
    expect(selectionIdentityKey(identities.get(0)!)).toBe("persistent:feature-1");
    expect(selectionIdentityKey(identities.get(1)!)).toBe("temporary:query-4:1");

    const strokes = queryResultStrokes(queryResult, {
      temporaryQueryKey: "query-4",
      persistentFeatureIds: new Set(["feature-1"]),
    });
    expect(strokes.map((stroke) => stroke.selectionIdentity && selectionIdentityKey(stroke.selectionIdentity))).toEqual(
      ["persistent:feature-1", "temporary:query-4:1"]
    );
  });

  it("geometryなしでも既存featureのcanonical id rowをpersistent identityにする", () => {
    const queryResult: QueryResult = {
      status: "success",
      columns: [
        { name: "id", type: "VARCHAR" },
        { name: "geometry_geojson", type: "VARCHAR", geometryRole: "geojson" },
      ],
      rows: [
        { id: "feature-1", geometry_geojson: null },
        { id: "feature-2", geometry_geojson: '{"type":"LineString","coordinates":[[0,0],[2,2]]}' },
      ],
      rowCount: 2,
      truncated: false,
    };
    const identities = queryResultSelectionIdentities(queryResult, "query-5", new Set(["feature-1", "feature-2"]));
    expect(selectionIdentityKey(identities.get(0)!)).toBe("persistent:feature-1");
    expect(selectionIdentityKey(identities.get(1)!)).toBe("persistent:feature-2");
  });

  it("canonical feature集合にないIDや非文字列IDをpersistentへ推測で紐付けない", () => {
    const queryResult: QueryResult = {
      ...result([
        '{"type":"LineString","coordinates":[[0,0],[2,2]]}',
        '{"type":"LineString","coordinates":[[2,0],[4,2]]}',
      ]),
      columns: [
        { name: "id", type: "VARCHAR" },
        { name: "geometry_geojson", type: "VARCHAR", geometryRole: "geojson" },
      ],
      rows: [
        { id: "unrelated", geometry_geojson: '{"type":"LineString","coordinates":[[0,0],[2,2]]}' },
        { id: 7, geometry_geojson: '{"type":"LineString","coordinates":[[2,0],[4,2]]}' },
      ],
    };
    const identities = queryResultSelectionIdentities(queryResult, "query-6", new Set(["feature-1"]));
    expect(selectionIdentityKey(identities.get(0)!)).toBe("temporary:query-6:0");
    expect(selectionIdentityKey(identities.get(1)!)).toBe("temporary:query-6:1");
  });
});
