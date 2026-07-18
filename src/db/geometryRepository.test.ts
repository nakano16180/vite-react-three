import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYER,
  DEFAULT_LAYER_ID,
  createGeometryFeature,
  type FeatureGeometry,
} from "../domain/geometryFeature";
import {
  CURRENT_SCHEMA_VERSION,
  GeometryRepository,
  PersistenceCheckpointError,
  mapSpatialFeatureRow,
  mergeLegacyFeatures,
  mapJsonFeatureRow,
  mapLegacyJsonRow,
} from "./geometryRepository";

const result = (rows: Array<Record<string, unknown>> = []) => ({
  toArray: () => rows.map((value) => ({ toJSON: () => value })),
});

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
    const query = vi.fn().mockResolvedValue(result());
    const close = vi.fn().mockResolvedValue(undefined);
    const prepare = vi.fn(async (sql: string) => ({
      query: sql.startsWith("SELECT 1 AS present") ? vi.fn().mockResolvedValue(result([{ present: 1 }])) : query,
      close,
    }));
    const connection = { prepare } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: store === "spatial",
      store,
    });

    await repository.updateGeometry("feature-1", geometry);

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1][0]).not.toContain("ST_Simplify");
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
    const query = vi.fn().mockResolvedValue(result());
    const prepare = vi.fn(async (sql: string) => ({
      query: sql.startsWith("SELECT 1 AS present") ? vi.fn().mockResolvedValue(result([{ present: 1 }])) : query,
      close: vi.fn().mockResolvedValue(undefined),
    }));
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
      query: vi.fn(async (...args: unknown[]) => {
        if (sql.startsWith("SELECT value") && args[0] === "legacy_strokes_migrated") {
          throw new Error("legacy read failed");
        }
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
    const statementQuery = vi.fn().mockResolvedValue(result());
    const connection = {
      query: vi.fn().mockResolvedValue({ toArray: () => [] }),
      prepare: vi.fn(async (sql: string) => ({
        query: sql.startsWith("SELECT 1 AS present")
          ? vi.fn().mockResolvedValue(result([{ present: 1 }]))
          : statementQuery,
        close: vi.fn().mockResolvedValue(undefined),
      })),
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
    const statementQuery = vi.fn().mockRejectedValue(new Error("feature insert failed"));
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql === "ROLLBACK;") throw new Error("rollback failed");
        return { toArray: () => [] };
      }),
      prepare: vi.fn(async (sql: string) => ({
        query: sql.startsWith("SELECT 1 AS present")
          ? vi.fn().mockResolvedValue(result([{ present: 1 }]))
          : sql.startsWith("INSERT INTO features_json")
            ? statementQuery
            : vi.fn().mockResolvedValue(result()),
        close: vi.fn().mockResolvedValue(undefined),
      })),
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
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn().mockResolvedValue(sql.startsWith("SELECT 1 AS present") ? result([{ present: 1 }]) : result()),
        close: vi.fn().mockResolvedValue(undefined),
      })),
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
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn().mockResolvedValue(sql.startsWith("SELECT 1 AS present") ? result([{ present: 1 }]) : result()),
        close: vi.fn().mockResolvedValue(undefined),
      })),
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
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn().mockResolvedValue(sql.startsWith("SELECT 1 AS present") ? result([{ present: 1 }]) : result()),
        close: vi.fn().mockResolvedValue(undefined),
      })),
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

describe("schema metadata", () => {
  it("未設定schema versionを現versionへ初期化する", async () => {
    const metadata = new Map<string, string>();
    const connection = {
      query: vi.fn().mockResolvedValue(result()),
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          if (sql.startsWith("INSERT INTO app_metadata")) {
            metadata.set(String(args[0]), String(args[1]));
          }
          if (sql.includes("information_schema.tables")) return result();
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize();

    expect(metadata.get("schema_version")).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("schema version 1へinserted_atを追加して現versionへ更新する", async () => {
    const metadata = new Map<string, string>([
      ["schema_version", "1"],
      ["active_feature_store", "json"],
      ["legacy_strokes_migrated", "true"],
    ]);
    const query = vi.fn().mockResolvedValue(result());
    const connection = {
      query,
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          if (sql.startsWith("INSERT INTO app_metadata")) metadata.set(String(args[0]), String(args[1]));
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize();

    expect(query.mock.calls.some(([sql]) => String(sql).includes("ADD COLUMN IF NOT EXISTS inserted_at"))).toBe(true);
    expect(metadata.get("schema_version")).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("未知の未来schema versionはfail closedする", async () => {
    const connection = {
      query: vi.fn().mockResolvedValue(result()),
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) =>
          sql.startsWith("SELECT value") && args[0] === "schema_version"
            ? result([{ value: String(CURRENT_SCHEMA_VERSION + 1) }])
            : result()
        ),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await expect(
      new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize()
    ).rejects.toThrow("Unsupported future schema version");
  });

  it("future schemaはcanonical DDLやmetadata mutationより前にfail closedする", async () => {
    const query = vi.fn().mockResolvedValue(result());
    const metadataWrite = vi.fn().mockResolvedValue(result());
    const connection = {
      query,
      prepare: vi.fn(async (sql: string) => ({
        query: sql.startsWith("SELECT value")
          ? vi.fn().mockResolvedValue(result([{ value: String(CURRENT_SCHEMA_VERSION + 1) }]))
          : metadataWrite,
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await expect(
      new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize()
    ).rejects.toThrow("Unsupported future schema version");

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("CREATE TABLE IF NOT EXISTS app_metadata");
    expect(String(query.mock.calls[0][0])).not.toContain("layers");
    expect(String(query.mock.calls[0][0])).not.toContain("features");
    expect(metadataWrite).not.toHaveBeenCalled();
  });

  it("schema gate後にnew DBのactive storeをpersistする", async () => {
    const metadata = new Map<string, string>();
    const connection = {
      query: vi.fn().mockResolvedValue(result()),
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          if (sql.startsWith("INSERT INTO app_metadata")) metadata.set(String(args[0]), String(args[1]));
          if (sql.includes("information_schema.tables")) return result();
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize();

    expect(metadata.get("active_feature_store")).toBe("json");
  });

  it("既存active storeとcapabilities.store不一致はfail closedする", async () => {
    const metadata = new Map<string, string>([
      ["schema_version", String(CURRENT_SCHEMA_VERSION)],
      ["active_feature_store", "spatial"],
    ]);
    const query = vi.fn().mockResolvedValue(result());
    const connection = {
      query,
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await expect(
      new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize()
    ).rejects.toThrow("Active feature store mismatch");
  });
});

describe("legacy migration row isolation", () => {
  it("valid/invalid JSON・Spatial rows混在でもvalid rowsをcommitしmarkerとskip warningを返す", async () => {
    const metadata = new Map<string, string>([["schema_version", String(CURRENT_SCHEMA_VERSION)]]);
    const insertedIds: string[] = [];
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM strokes_json")) {
          return result([
            {
              id: "valid",
              coords: "[[0,0],[2,2]]",
              color: "#111111",
              width: 2,
              geom_type: "line",
              created_at: "2026-07-18T00:00:00.000Z",
            },
            {
              id: "invalid",
              coords: "not-json",
              color: "#111111",
              width: 2,
              geom_type: "line",
              created_at: "2026-07-18T00:00:00.000Z",
            },
          ]);
        }
        if (sql.includes("FROM strokes ORDER BY")) {
          return result([
            {
              id: "valid-spatial",
              geometry: '{"type":"LineString","coordinates":[[3,3],[4,4]]}',
              color: "#222222",
              width: 3,
              geom_type: "line",
              created_at: "2026-07-18T00:00:00.000Z",
            },
            {
              id: "invalid-spatial",
              geometry: "not-json",
              color: "#222222",
              width: 3,
              geom_type: "line",
              created_at: "2026-07-18T00:00:00.000Z",
            },
          ]);
        }
        return result();
      }),
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          if (sql.includes("information_schema.tables")) {
            return result([{ table_name: "strokes_json" }, { table_name: "strokes" }]);
          }
          if (sql.startsWith("INSERT INTO app_metadata")) metadata.set(String(args[0]), String(args[1]));
          if (sql.startsWith("SELECT 1 AS present")) return result([{ present: 1 }]);
          if (sql.startsWith("INSERT INTO features_json")) insertedIds.push(String(args[0]));
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await expect(
      new GeometryRepository(connection, { opfs: false, spatial: true, store: "json" }).initialize()
    ).resolves.toEqual({ migrationWarning: "Legacy stroke migration skipped 2 invalid rows." });
    expect(insertedIds).toEqual(["valid", "valid-spatial"]);
    expect(metadata.get("legacy_strokes_migrated")).toBe("true");
    expect(connection.query).toHaveBeenCalledWith("COMMIT;");
  });

  it("valid geometryのinvalid created_atはfallbackし正常rowと同じtransactionでcommitする", async () => {
    const metadata = new Map<string, string>([["schema_version", String(CURRENT_SCHEMA_VERSION)]]);
    const inserted = new Map<string, string>();
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM strokes_json")) {
          return result([
            {
              id: "invalid-date",
              coords: "[[0,0],[2,2]]",
              color: "#111111",
              width: 2,
              geom_type: "line",
              created_at: null,
            },
            {
              id: "valid-date",
              coords: "[[3,3],[4,4]]",
              color: "#222222",
              width: 3,
              geom_type: "line",
              created_at: "2026-07-18T00:00:00.000Z",
            },
          ]);
        }
        if (sql.includes("FROM strokes ORDER BY")) {
          return result([
            {
              id: "invalid-spatial-date",
              geometry: '{"type":"LineString","coordinates":[[5,5],[6,6]]}',
              color: "#333333",
              width: 4,
              geom_type: "line",
              created_at: "",
            },
          ]);
        }
        return result();
      }),
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          if (sql.includes("information_schema.tables")) {
            return result([{ table_name: "strokes_json" }, { table_name: "strokes" }]);
          }
          if (sql.startsWith("INSERT INTO app_metadata")) metadata.set(String(args[0]), String(args[1]));
          if (sql.startsWith("SELECT 1 AS present")) return result([{ present: 1 }]);
          if (sql.startsWith("INSERT INTO features_json")) inserted.set(String(args[0]), String(args[6]));
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await expect(
      new GeometryRepository(connection, { opfs: false, spatial: true, store: "json" }).initialize()
    ).resolves.toEqual({
      migrationWarning: "Legacy stroke migration replaced 2 invalid created_at values.",
    });
    expect(inserted.size).toBe(3);
    expect(Number.isFinite(Date.parse(inserted.get("invalid-date") ?? ""))).toBe(true);
    expect(Number.isFinite(Date.parse(inserted.get("invalid-spatial-date") ?? ""))).toBe(true);
    expect(inserted.get("valid-date")).toBe("2026-07-18T00:00:00.000Z");
    expect(metadata.get("legacy_strokes_migrated")).toBe("true");
    expect(connection.query).toHaveBeenCalledWith("COMMIT;");
  });

  it("Spatialなしではlegacy strokesを保留しstrokes_jsonだけcommitする", async () => {
    const metadata = new Map<string, string>([["schema_version", String(CURRENT_SCHEMA_VERSION)]]);
    const insertedIds: string[] = [];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM strokes_json")) {
        return result([
          {
            id: "json-only",
            coords: "[[0,0],[2,2]]",
            color: "#111111",
            width: 2,
            geom_type: "line",
            created_at: "2026-07-18T00:00:00.000Z",
          },
        ]);
      }
      if (sql.includes("ST_AsGeoJSON")) throw new Error("Spatial function is unavailable");
      return result();
    });
    const connection = {
      query,
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async (...args: unknown[]) => {
          if (sql.startsWith("SELECT value")) {
            const value = metadata.get(String(args[0]));
            return result(value === undefined ? [] : [{ value }]);
          }
          if (sql.includes("information_schema.tables")) {
            return result([{ table_name: "strokes_json" }, { table_name: "strokes" }]);
          }
          if (sql.startsWith("INSERT INTO app_metadata")) metadata.set(String(args[0]), String(args[1]));
          if (sql.startsWith("SELECT 1 AS present")) return result([{ present: 1 }]);
          if (sql.startsWith("INSERT INTO features_json")) insertedIds.push(String(args[0]));
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;

    await expect(
      new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).initialize()
    ).resolves.toEqual({
      migrationWarning: "Legacy Spatial stroke migration is pending until the Spatial extension is available.",
    });

    expect(insertedIds).toEqual(["json-only"]);
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("ST_AsGeoJSON"))).toBe(true);
    expect(metadata.get("legacy_strokes_migrated")).toBeUndefined();
    expect(query).toHaveBeenCalledWith("COMMIT;");
  });
});

describe("undo insertion order", () => {
  it.each(["spatial", "json"] as const)("%s Undoはcanonical created_atではなくinserted_atを使う", async (store) => {
    const query = vi.fn().mockResolvedValue(result());
    const repository = new GeometryRepository({ query } as unknown as AsyncDuckDBConnection, {
      opfs: false,
      spatial: store === "spatial",
      store,
    });

    await repository.deleteLatestFeature();

    expect(String(query.mock.calls[0][0])).toContain("ORDER BY inserted_at DESC");
    expect(String(query.mock.calls[0][0])).not.toContain("ORDER BY created_at DESC");
  });
});

describe("layer invariant", () => {
  it.each(["spatial", "json"] as const)("%s insertは存在しないlayerをrejectする", async (store) => {
    const connection = {
      prepare: vi.fn(async () => ({
        query: vi.fn().mockResolvedValue(result()),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: store === "spatial",
      store,
    });
    const feature = createGeometryFeature({
      layerId: "missing",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });

    await expect(repository.insertFeature(feature)).rejects.toThrow('Layer "missing" does not exist');
  });

  it("importはlayer insert後の同transaction内でfeature layerを検証する", async () => {
    let layerInserted = false;
    const connection = {
      query: vi.fn().mockResolvedValue(result()),
      prepare: vi.fn(async (sql: string) => ({
        query: vi.fn(async () => {
          if (sql.startsWith("INSERT INTO layers")) layerInserted = true;
          if (sql.startsWith("SELECT 1 AS present")) return result(layerInserted ? [{ present: 1 }] : []);
          return result();
        }),
        close: vi.fn(),
      })),
    } as unknown as AsyncDuckDBConnection;
    const feature = createGeometryFeature({
      layerId: "imported-layer",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });

    await new GeometryRepository(connection, { opfs: false, spatial: false, store: "json" }).importGeoJSON(
      [{ ...DEFAULT_LAYER, id: "imported-layer" }],
      [feature]
    );

    expect(layerInserted).toBe(true);
    expect(connection.query).toHaveBeenCalledWith("COMMIT;");
  });

  it.each(["spatial", "json"] as const)("%s updateはorphan featureをrejectする", async (store) => {
    const connection = {
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue(result()),
        close: vi.fn(),
      }),
    } as unknown as AsyncDuckDBConnection;
    const repository = new GeometryRepository(connection, {
      opfs: false,
      spatial: store === "spatial",
      store,
    });

    await expect(
      repository.updateGeometry("orphan", {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      })
    ).rejects.toThrow('Feature "orphan" does not reference an existing layer');
  });
});
