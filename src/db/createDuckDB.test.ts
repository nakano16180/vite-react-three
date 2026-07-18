import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { describe, expect, it, vi } from "vitest";
import { StoredFeatureStoreUnavailableError, bootstrapDuckDB, type FeatureStore } from "./createDuckDB";
import { CURRENT_SCHEMA_VERSION, GeometryRepository } from "./geometryRepository";

const result = (rows: Array<Record<string, unknown>> = []) => ({
  toArray: () => rows.map((value) => ({ toJSON: () => value })),
});

const bootstrapFixture = (activeStore?: FeatureStore, spatialAvailable = true) => {
  const metadata = new Map<string, string>();
  if (activeStore) metadata.set("active_feature_store", activeStore);
  const metadataWrites: Array<[string, string]> = [];
  const query = vi.fn(async (sql: string) => {
    if (!spatialAvailable && sql === "INSTALL spatial;") throw new Error("offline");
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
        if (sql.startsWith("INSERT INTO app_metadata")) {
          const entry: [string, string] = [String(args[0]), String(args[1])];
          metadataWrites.push(entry);
          metadata.set(...entry);
        }
        if (sql.includes("information_schema.tables")) return result();
        return result();
      }),
      close: vi.fn(),
    })),
    close: vi.fn(),
  } as unknown as AsyncDuckDBConnection;
  const db = {
    instantiate: vi.fn(),
    open: vi.fn(),
    connect: vi.fn().mockResolvedValue(connection),
    terminate: vi.fn(),
  } as unknown as AsyncDuckDB;
  return { connection, db, metadata, metadataWrites, query };
};

describe("DuckDB bootstrap cleanup", () => {
  it("metadata failureでconnectionとdatabaseをbest-effort cleanupする", async () => {
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    const statementClose = vi.fn().mockResolvedValue(undefined);
    const connection = {
      query: vi.fn().mockResolvedValue({ toArray: () => [] }),
      prepare: vi.fn().mockResolvedValue({
        query: vi.fn().mockRejectedValue(new Error("metadata read failed")),
        close: statementClose,
      }),
      close,
    } as unknown as AsyncDuckDBConnection;
    const terminate = vi.fn().mockResolvedValue(undefined);
    const db = {
      instantiate: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(connection),
      terminate,
    } as unknown as AsyncDuckDB;

    await expect(
      bootstrapDuckDB(db, {
        mainModule: "duckdb.wasm",
        mainWorker: "duckdb.worker.js",
        pthreadWorker: null,
      })
    ).rejects.toThrow("metadata read failed");
    expect(statementClose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("connection前のfailureでもdatabaseをterminateする", async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const db = {
      instantiate: vi.fn().mockRejectedValue(new Error("instantiate failed")),
      terminate,
    } as unknown as AsyncDuckDB;

    await expect(
      bootstrapDuckDB(db, {
        mainModule: "duckdb.wasm",
        mainWorker: "duckdb.worker.js",
        pthreadWorker: null,
      })
    ).rejects.toThrow("instantiate failed");
    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("DuckDB feature store selection", () => {
  it("未設定storeはSpatial availabilityから選ぶがbootstrapではpersistしない", async () => {
    const fixture = bootstrapFixture();

    const context = await bootstrapDuckDB(fixture.db);

    expect(context.capabilities.store).toBe("spatial");
    expect(fixture.metadataWrites).toEqual([]);
  });

  it("既存JSON storeをSpatial availabilityより優先してstickyに使う", async () => {
    const fixture = bootstrapFixture("json");

    const context = await bootstrapDuckDB(fixture.db);

    expect(context.capabilities.store).toBe("json");
    expect(fixture.metadataWrites).toEqual([]);
  });

  it("既存Spatial storeでSpatial unavailableなら明示errorにする", async () => {
    const fixture = bootstrapFixture("spatial", false);

    await expect(bootstrapDuckDB(fixture.db)).rejects.toBeInstanceOf(StoredFeatureStoreUnavailableError);
  });

  it.each([
    ["future", String(CURRENT_SCHEMA_VERSION + 1), "Unsupported future schema version"],
    ["malformed", "not-a-version", "Unsupported schema version"],
  ])(
    "%s schemaとstore未設定ではbootstrapからrepositoryまでactive storeをwriteしない",
    async (_case, version, error) => {
      const fixture = bootstrapFixture();
      fixture.metadata.set("schema_version", version);
      const context = await bootstrapDuckDB(fixture.db);

      await expect(new GeometryRepository(fixture.connection, context.capabilities).initialize()).rejects.toThrow(
        error
      );

      expect(fixture.metadataWrites.filter(([key]) => key === "active_feature_store")).toEqual([]);
      const ddl = fixture.query.mock.calls.map(([sql]) => String(sql));
      expect(ddl.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS layers"))).toBe(false);
      expect(ddl.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS features"))).toBe(false);
    }
  );
});
