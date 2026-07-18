import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "../dbBundles";

export type FeatureStore = "spatial" | "json";

export interface DuckDBCapabilities {
  opfs: boolean;
  spatial: boolean;
  store: FeatureStore;
}

export interface DuckDBContext {
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
  capabilities: DuckDBCapabilities;
}

export class StoredFeatureStoreUnavailableError extends Error {
  constructor() {
    super("The database requires the Spatial feature store, but the Spatial extension is unavailable.");
    this.name = "StoredFeatureStoreUnavailableError";
  }
}

type BootstrapDatabase = Pick<duckdb.AsyncDuckDB, "instantiate" | "open" | "connect" | "terminate">;

const readActiveStore = async (connection: duckdb.AsyncDuckDBConnection): Promise<FeatureStore | undefined> => {
  const statement = await connection.prepare("SELECT value FROM app_metadata WHERE key = ?;");
  try {
    const rows = (await statement.query("active_feature_store")).toArray();
    if (rows.length === 0) return undefined;
    const value = String((rows[0].toJSON() as { value: unknown }).value);
    if (value === "spatial" || value === "json") return value;
    throw new Error(`Unsupported active feature store: ${value}`);
  } finally {
    await statement.close();
  }
};

export const bootstrapDuckDB = async (
  db: BootstrapDatabase,
  selectedBundle: typeof bundle = bundle
): Promise<DuckDBContext> => {
  let connection: duckdb.AsyncDuckDBConnection | undefined;
  let opfs = false;
  try {
    await db.instantiate(selectedBundle.mainModule, selectedBundle.pthreadWorker);
    try {
      await db.open({
        path: "opfs://vite-react-three.duckdb",
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      });
      opfs = true;
    } catch (error) {
      console.warn("OPFS not available, using in-memory database:", error);
    }

    connection = await db.connect();
    let spatial = false;
    try {
      await connection.query("INSTALL spatial;");
      await connection.query("LOAD spatial;");
      spatial = true;
    } catch (error) {
      console.warn("Spatial extension load failed:", error);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const stored = await readActiveStore(connection);
    if (stored === "spatial" && !spatial) throw new StoredFeatureStoreUnavailableError();
    const store = stored ?? (spatial ? "spatial" : "json");

    return { db: db as duckdb.AsyncDuckDB, connection, capabilities: { opfs, spatial, store } };
  } catch (error) {
    if (connection) {
      try {
        await connection.close();
      } catch {
        // Preserve the bootstrap failure; cleanup is best-effort.
      }
    }
    try {
      await db.terminate();
    } catch {
      // Preserve the bootstrap failure; cleanup is best-effort.
    }
    throw error;
  }
};

export const createDuckDB = async (): Promise<DuckDBContext> => {
  const worker = new Worker(bundle.mainWorker!, { type: "module" });
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  return bootstrapDuckDB(db);
};
