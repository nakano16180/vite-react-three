import * as duckdb from "@duckdb/duckdb-wasm";
import { bundle } from "../dbBundles";
import { initializeQueryViews, type QuerySnapshot } from "./queryViews";

const QUERY_ROW_LIMIT = 1000;
const PROHIBITED_KEYWORDS =
  /\b(ALTER|ATTACH|CALL|CHECKPOINT|COMMENT|COPY|CREATE|DELETE|DETACH|DROP|EXPORT|IMPORT|INSERT|INSTALL|LOAD|MERGE|PRAGMA|SET|TRUNCATE|UPDATE|VACUUM)\b/i;

export class QueryRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryRejectedError";
  }
}

const scrubSql = (sql: string): string => {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index += 2;
      output += " ";
    } else if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      output += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote && sql[index + 1] === quote) {
          index += 2;
        } else if (sql[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
};

export const validateReadOnlySql = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) throw new QueryRejectedError("SQL query is empty.");
  const scrubbed = scrubSql(trimmed);
  const withoutTrailingSemicolon = trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
  const scrubbedWithoutTrailingSemicolon = scrubbed.endsWith(";") ? scrubbed.slice(0, -1) : scrubbed;
  if (scrubbedWithoutTrailingSemicolon.includes(";")) {
    throw new QueryRejectedError("Only one SQL statement is allowed.");
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(scrubbedWithoutTrailingSemicolon)) {
    throw new QueryRejectedError("Only SELECT or WITH...SELECT queries are allowed.");
  }
  if (PROHIBITED_KEYWORDS.test(scrubbedWithoutTrailingSemicolon)) {
    throw new QueryRejectedError("The query contains a statement that can change state.");
  }
  return withoutTrailingSemicolon;
};

export interface QueryColumn {
  name: string;
  type: string;
  geometryRole?: "geojson";
}

export interface QueryResult {
  status: "success" | "empty";
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

interface QueryConnection {
  send(
    sql: string,
    allowStreamResult?: boolean
  ): Promise<{
    schema?: { fields: Array<{ name: string; type: { toString(): string } }> };
    open(): Promise<unknown>;
    [Symbol.asyncIterator](): AsyncIterator<{
      schema: { fields: Array<{ name: string; type: { toString(): string } }> };
      toArray(): Array<{ toJSON(): Record<string, unknown> }>;
    }>;
  }>;
  cancelSent(): Promise<boolean>;
  close(): Promise<void>;
}

interface QueryDatabase {
  connect(): Promise<QueryConnection>;
  terminate(): Promise<unknown>;
}

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
};

export class QueryRuntime {
  private epoch = 0;
  private disposed = false;
  private active?: { connection: QueryConnection; epoch: number };
  private readonly database: QueryDatabase;
  private readonly cleanupAdmin: () => Promise<void>;
  private readonly synchronize?: (snapshot: QuerySnapshot) => Promise<void>;

  constructor(
    database: QueryDatabase,
    cleanupAdmin: () => Promise<void> = async () => undefined,
    synchronize?: (snapshot: QuerySnapshot) => Promise<void>
  ) {
    this.database = database;
    this.cleanupAdmin = cleanupAdmin;
    this.synchronize = synchronize;
  }

  async execute(sql: string): Promise<QueryResult | null> {
    if (this.disposed) throw new Error("Query runtime is disposed.");
    const normalized = validateReadOnlySql(sql);
    const epoch = ++this.epoch;
    const connection = await this.database.connect();
    if (this.disposed || epoch !== this.epoch) {
      await connection.close().catch(() => undefined);
      return null;
    }
    this.active = { connection, epoch };
    try {
      const stream = await connection.send(
        `SELECT * FROM (${normalized}) AS user_result LIMIT ${QUERY_ROW_LIMIT + 1}`,
        true
      );
      await stream.open();
      const rows: Record<string, unknown>[] = [];
      let schema = stream.schema;
      for await (const batch of stream) {
        schema ??= batch.schema;
        for (const row of batch.toArray()) {
          if (rows.length > QUERY_ROW_LIMIT) break;
          rows.push(jsonSafe(row.toJSON()) as Record<string, unknown>);
        }
        if (rows.length > QUERY_ROW_LIMIT) break;
      }
      if (this.disposed || epoch !== this.epoch) return null;
      if (!schema) throw new Error("DuckDB query result did not provide a schema.");
      const columns = schema.fields.map((field) => ({
        name: field.name,
        type: field.type.toString(),
        ...(field.name === "geometry_geojson" ? { geometryRole: "geojson" as const } : {}),
      }));
      const truncated = rows.length > QUERY_ROW_LIMIT;
      if (truncated) rows.length = QUERY_ROW_LIMIT;
      return {
        status: rows.length === 0 ? "empty" : "success",
        columns,
        rows,
        rowCount: rows.length,
        truncated,
      };
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return null;
      throw error;
    } finally {
      if (this.active?.epoch === epoch) this.active = undefined;
      await connection.close().catch(() => undefined);
    }
  }

  async cancel(): Promise<void> {
    this.epoch += 1;
    const active = this.active;
    this.active = undefined;
    if (active) await active.connection.cancelSent().catch(() => false);
  }

  async refresh(snapshot: QuerySnapshot): Promise<void> {
    if (!this.synchronize) throw new Error("Query snapshot refresh is unavailable.");
    await this.cancel();
    await this.synchronize(snapshot);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.cancel();
    await this.cleanupAdmin().catch(() => undefined);
    await this.database.terminate().catch(() => undefined);
  }
}

export const createQueryRuntime = async (snapshot: QuerySnapshot): Promise<QueryRuntime> => {
  const worker = new Worker(bundle.mainWorker!, { type: "module" });
  const database = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  let admin: duckdb.AsyncDuckDBConnection | undefined;
  try {
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    admin = await database.connect();
    try {
      await admin.query("INSTALL spatial;");
      await admin.query("LOAD spatial;");
    } catch (error) {
      console.warn("Spatial extension load failed in query sandbox:", error);
    }
    await initializeQueryViews(admin, snapshot);
    await admin.query("SET enable_external_access = false;");
    await admin.query("SET lock_configuration = true;");
    const ownedAdmin = admin;
    return new QueryRuntime(
      database,
      () => ownedAdmin.close(),
      (nextSnapshot) => initializeQueryViews(ownedAdmin, nextSnapshot)
    );
  } catch (error) {
    await admin?.close().catch(() => undefined);
    await database.terminate().catch(() => undefined);
    throw error;
  }
};
