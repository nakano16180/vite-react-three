import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYER,
  DEFAULT_LAYER_ID,
  createGeometryFeature,
  type FeatureGeometry,
} from "../domain/geometryFeature";
import {
  GeometryRepository,
  PersistenceCheckpointError,
  mapSpatialFeatureRow,
  mergeLegacyFeatures,
  mapJsonFeatureRow,
  mapLegacyJsonRow,
} from "./geometryRepository";

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

  it("未知のgeometry typeをLineStringへ暗黙変換せずrejectする", () => {
    expect(() =>
      mapJsonFeatureRow({
        id: "point-1",
        geom_type: "Point",
        coordinates: "[[0,0],[2,2]]",
        properties: "{}",
        style: '{"strokeColor":"#123456","strokeWidth":5}',
        layer_id: DEFAULT_LAYER_ID,
        created_at: "2026-07-18T00:00:00.000Z",
      })
    ).toThrow("Unsupported geometry type");
  });

  it("hole付きSpatial Polygonを外周だけへ縮退させずrejectする", () => {
    expect(() =>
      mapSpatialFeatureRow({
        id: "polygon-with-hole",
        geometry: JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 0],
            ],
            [
              [1, 1],
              [2, 1],
              [1, 2],
              [1, 1],
            ],
          ],
        }),
        properties: "{}",
        style: '{"strokeColor":"#123456","strokeWidth":5}',
        layer_id: DEFAULT_LAYER_ID,
        created_at: "2026-07-18T00:00:00.000Z",
      })
    ).toThrow("Polygon holes are not supported");
  });
});

describe("geometry repository store parity", () => {
  const geometry: FeatureGeometry = {
    type: "LineString",
    coordinates: [
      [0, 0],
      [1, 0.25],
      [2, 0],
    ],
  };

  it.each(["spatial", "json"] as const)("%s updateはcanonical geometryをsimplifyせず保存する", async (store) => {
    const query = vi.fn().mockResolvedValue({ toArray: () => [] });
    const close = vi.fn().mockResolvedValue(undefined);
    const prepare = vi.fn().mockResolvedValue({ query, close });
    const connection = { prepare } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: store === "spatial",
      store,
    });

    await repository.updateGeometry("feature-1", geometry);

    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][0]).not.toContain("ST_Simplify");
    expect(query).toHaveBeenCalledOnce();
    if (store === "spatial") {
      expect(query).toHaveBeenCalledWith("LINESTRING(0 0, 1 0.25, 2 0)", "feature-1");
    } else {
      expect(query).toHaveBeenCalledWith("LineString", JSON.stringify(geometry.coordinates), "feature-1");
    }
  });

  it.each(["spatial", "json"] as const)("%s updateは同じcanonical Polygon頂点を保持する", async (store) => {
    const polygon: FeatureGeometry = {
      type: "Polygon",
      coordinates: [
        [0, 0],
        [3, 0],
        [3, 2],
      ],
    };
    const query = vi.fn().mockResolvedValue({ toArray: () => [] });
    const prepare = vi.fn().mockResolvedValue({
      query,
      close: vi.fn().mockResolvedValue(undefined),
    });
    const repository = new GeometryRepository({ prepare } as unknown as AsyncDuckDBConnection, {
      opfs: false,
      spatial: store === "spatial",
      store,
    });

    await repository.updateGeometry("polygon-1", polygon);

    if (store === "spatial") {
      expect(query).toHaveBeenCalledWith("POLYGON((0 0, 3 0, 3 2, 0 0))", "polygon-1");
    } else {
      expect(query).toHaveBeenCalledWith("Polygon", JSON.stringify(polygon.coordinates), "polygon-1");
    }
  });

  it("rollback失敗時も元のmigration errorをwarningで返す", async () => {
    const prepare = vi.fn(async (sql: string) => ({
      query: vi.fn(async () => {
        if (sql.startsWith("SELECT value")) throw new Error("legacy read failed");
        return { toArray: () => [] };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    const query = vi.fn(async (sql: string) => {
      if (sql === "ROLLBACK;") throw new Error("rollback failed");
      return { toArray: () => [] };
    });
    const connection = { prepare, query } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: false,
      store: "json",
    });

    await expect(repository.initialize()).resolves.toEqual({
      migrationWarning: "Legacy stroke migration failed: legacy read failed",
    });
  });
});

describe("legacy migration precedence", () => {
  it("同じIDではstrokes由来featureを優先する", () => {
    const jsonFeature = mapLegacyJsonRow({
      id: "shared",
      coords: "[[0,0],[1,1]]",
      color: "#111111",
      width: 2,
      geom_type: "line",
      created_at: "2026-07-18T00:00:00.000Z",
    });
    const spatialFeature = {
      ...jsonFeature,
      style: { ...jsonFeature.style, strokeColor: "#222222" },
    };

    expect(mergeLegacyFeatures([jsonFeature], [spatialFeature])).toEqual([spatialFeature]);
  });
});

describe("transactional GeoJSON import", () => {
  it("layers/featuresを単一transactionでcommitする", async () => {
    const statementQuery = vi.fn().mockResolvedValue({ toArray: () => [] });
    const connection = {
      query: vi.fn().mockResolvedValue({ toArray: () => [] }),
      prepare: vi.fn().mockResolvedValue({
        query: statementQuery,
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: false,
      store: "json",
    });
    const feature = createGeometryFeature({
      id: "import-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });

    await repository.importGeoJSON([DEFAULT_LAYER], [feature]);

    expect(connection.query).toHaveBeenNthCalledWith(1, "BEGIN TRANSACTION;");
    expect(connection.query).toHaveBeenNthCalledWith(2, "COMMIT;");
  });

  it("途中failure時にrollbackし元errorを保持する", async () => {
    const statementQuery = vi
      .fn()
      .mockResolvedValueOnce({ toArray: () => [] })
      .mockRejectedValueOnce(new Error("feature insert failed"));
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql === "ROLLBACK;") throw new Error("rollback failed");
        return { toArray: () => [] };
      }),
      prepare: vi.fn().mockResolvedValue({
        query: statementQuery,
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: false,
      store: "json",
    });
    const feature = createGeometryFeature({
      id: "import-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });

    await expect(repository.importGeoJSON([DEFAULT_LAYER], [feature])).rejects.toThrow("feature insert failed");
    expect(connection.query).toHaveBeenCalledWith("ROLLBACK;");
    expect(connection.query).not.toHaveBeenCalledWith("COMMIT;");
  });
});

describe("OPFS durability", () => {
  const feature = createGeometryFeature({
    id: "durable-1",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  });

  it("feature insert完了前にCHECKPOINTをawaitする", async () => {
    const checkpoint = vi.fn().mockResolvedValue({ toArray: () => [] });
    const connection = {
      query: checkpoint,
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ toArray: () => [] }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: true,
      spatial: false,
      store: "json",
    });

    await repository.insertFeature(feature);

    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith("CHECKPOINT;");
  });

  it("GeoJSON importはCOMMIT後に一度だけCHECKPOINTする", async () => {
    const query = vi.fn().mockResolvedValue({ toArray: () => [] });
    const connection = {
      query,
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ toArray: () => [] }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: true,
      spatial: false,
      store: "json",
    });

    await repository.importGeoJSON([DEFAULT_LAYER], [feature]);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN TRANSACTION;", "COMMIT;", "CHECKPOINT;"]);
  });

  it("CHECKPOINT失敗は書込み成功を明示するdiagnostic errorにする", async () => {
    const connection = {
      query: vi.fn().mockRejectedValue(new Error("disk full")),
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ toArray: () => [] }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: true,
      spatial: false,
      store: "json",
    });

    await expect(repository.insertFeature(feature)).rejects.toEqual(
      expect.objectContaining<PersistenceCheckpointError>({
        name: "PersistenceCheckpointError",
        message: expect.stringContaining("write succeeded"),
      })
    );
  });

  it("migration COMMIT後のCHECKPOINT失敗はrollbackせずwarningを返す", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "CHECKPOINT;") throw new Error("quota exceeded");
      return { toArray: () => [] };
    });
    const connection = {
      query,
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ toArray: () => [] }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: true,
      spatial: false,
      store: "json",
    });

    await expect(repository.initialize()).resolves.toEqual({
      migrationWarning: expect.stringContaining("write succeeded"),
    });
    expect(query).not.toHaveBeenCalledWith("ROLLBACK;");
  });
});
