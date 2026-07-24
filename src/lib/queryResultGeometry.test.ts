import { describe, expect, it } from "vitest";
import type { QueryResult } from "../db/queryRuntime";
import { queryResultStrokes } from "./queryResultGeometry";

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
      ])
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
  });

  it("NULL、invalid、unsupported geometryをskipしrows自体は変更しない", () => {
    const queryResult = result([null, "not-json", '{"type":"Point","coordinates":[1,2]}']);
    expect(queryResultStrokes(queryResult)).toEqual([]);
    expect(queryResult.rows).toHaveLength(3);
  });

  it("geometry role列がなければ描画しない", () => {
    expect(queryResultStrokes({ ...result([]), columns: [{ name: "id", type: "VARCHAR" }] })).toEqual([]);
  });
});
