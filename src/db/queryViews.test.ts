import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { describe, expect, it, vi } from "vitest";
import type { Layer } from "../domain/geometryFeature";
import { QUERY_FEATURES_VIEW, QUERY_LAYERS_VIEW, initializeQueryViews, type QuerySnapshot } from "./queryViews";
import { mapJsonFeatureRow, mapSpatialFeatureRow } from "./geometryRepository";

const emptyResult = () => ({ toArray: () => [] });

const snapshot: QuerySnapshot = {
  features: [
    {
      id: "line-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 1],
          [2, 3],
        ],
      },
      properties: { category: "road" },
      style: { strokeColor: "#112233", strokeWidth: 2 },
      layerId: "layer-1",
      createdAt: "2026-07-24T00:00:00.000Z",
    },
    {
      id: "polygon-1",
      geometry: {
        type: "Polygon",
        coordinates: [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
      },
      properties: { category: "parcel" },
      style: { strokeColor: "#445566", strokeWidth: 3, fillColor: "#abcdef", fillOpacity: 0.4 },
      layerId: "layer-1",
      createdAt: "2026-07-24T00:01:00.000Z",
    },
  ],
  layers: [
    {
      id: "layer-1",
      name: "Imported",
      visible: true,
      order: 4,
      createdAt: "2026-07-23T00:00:00.000Z",
    },
  ],
};

const createConnection = () => {
  const prepared = new Map<string, ReturnType<typeof vi.fn>>();
  const query = vi.fn().mockResolvedValue(emptyResult());
  const prepare = vi.fn(async (sql: string) => {
    const execute = vi.fn().mockResolvedValue(emptyResult());
    prepared.set(sql, execute);
    return { query: execute, close: vi.fn() };
  });
  return {
    connection: { query, prepare } as unknown as AsyncDuckDBConnection,
    prepare,
    prepared,
    query,
  };
};

describe("query views", () => {
  it("canonical featureとlayerをdocumented viewへtransactionalに同期する", async () => {
    const fixture = createConnection();

    await initializeQueryViews(fixture.connection, snapshot);

    const sql = fixture.query.mock.calls.map(([statement]) => String(statement));
    expect(sql[0]).toBe("BEGIN TRANSACTION;");
    expect(sql.at(-1)).toBe("COMMIT;");
    expect(sql.some((statement) => statement.includes(`CREATE OR REPLACE VIEW ${QUERY_FEATURES_VIEW}`))).toBe(true);
    expect(sql.some((statement) => statement.includes(`CREATE OR REPLACE VIEW ${QUERY_LAYERS_VIEW}`))).toBe(true);

    const layerInsert = [...fixture.prepared.entries()].find(([statement]) =>
      statement.includes("INSERT INTO query_snapshot_layers")
    )?.[1];
    expect(layerInsert).toHaveBeenCalledWith("layer-1", "Imported", true, 4, "2026-07-23T00:00:00.000Z");

    const featureInsert = [...fixture.prepared.entries()].find(([statement]) =>
      statement.includes("INSERT INTO query_snapshot_features")
    )?.[1];
    expect(featureInsert).toHaveBeenNthCalledWith(
      1,
      "line-1",
      "LineString",
      '{"type":"LineString","coordinates":[[0,1],[2,3]]}',
      '{"category":"road"}',
      '{"strokeColor":"#112233","strokeWidth":2}',
      "layer-1",
      "2026-07-24T00:00:00.000Z",
      1
    );
    expect(featureInsert).toHaveBeenNthCalledWith(
      2,
      "polygon-1",
      "Polygon",
      '{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]}',
      '{"category":"parcel"}',
      '{"strokeColor":"#445566","strokeWidth":3,"fillColor":"#abcdef","fillOpacity":0.4}',
      "layer-1",
      "2026-07-24T00:01:00.000Z",
      2
    );
  });

  it("Spatial/JSON repository rowsから同じcanonical view valuesを作る", async () => {
    const spatialFixture = createConnection();
    const jsonFixture = createConnection();
    const style = '{"strokeColor":"#112233","strokeWidth":2}';
    const properties = '{"category":"road"}';
    const spatialFeature = mapSpatialFeatureRow({
      id: "line-1",
      geometry: '{"type":"LineString","coordinates":[[0,1],[2,3]]}',
      properties,
      style,
      layer_id: "layer-1",
      created_at: "2026-07-24T00:00:00.000Z",
    });
    const jsonFeature = mapJsonFeatureRow({
      id: "line-1",
      geom_type: "LineString",
      coordinates: "[[0,1],[2,3]]",
      properties,
      style,
      layer_id: "layer-1",
      created_at: "2026-07-24T00:00:00.000Z",
    });
    const layers: Layer[] = snapshot.layers.map((layer) => ({ ...layer }));

    await initializeQueryViews(spatialFixture.connection, { features: [spatialFeature], layers });
    await initializeQueryViews(jsonFixture.connection, { features: [jsonFeature], layers });

    const featureCalls = (fixture: ReturnType<typeof createConnection>) =>
      [...fixture.prepared.entries()].find(([statement]) =>
        statement.includes("INSERT INTO query_snapshot_features")
      )?.[1].mock.calls;
    expect(featureCalls(spatialFixture)).toEqual(featureCalls(jsonFixture));

    const viewSql = spatialFixture.query.mock.calls
      .map(([statement]) => String(statement))
      .filter((statement) => statement.includes("CREATE OR REPLACE VIEW"));
    expect(viewSql).toEqual([
      expect.stringContaining(
        "id, geometry_type, geometry_geojson, properties, style, layer_id, created_at, feature_order"
      ),
      expect.stringContaining("id, name, visible, layer_order, created_at"),
    ]);
  });

  it("snapshot同期失敗時はrollbackしてcommitしない", async () => {
    const fixture = createConnection();
    fixture.prepare.mockImplementation(async (sql: string) => ({
      query: vi.fn(async () => {
        if (sql.includes("INSERT INTO query_snapshot_features")) throw new Error("snapshot insert failed");
        return emptyResult();
      }),
      close: vi.fn(),
    }));

    await expect(initializeQueryViews(fixture.connection, snapshot)).rejects.toThrow("snapshot insert failed");

    expect(fixture.query).toHaveBeenCalledWith("ROLLBACK;");
    expect(fixture.query).not.toHaveBeenCalledWith("COMMIT;");
  });
});
