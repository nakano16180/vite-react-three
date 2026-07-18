import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import {
  DEFAULT_LAYER,
  DEFAULT_LAYER_ID,
  createDefaultStyle,
  isFeatureGeometry,
  type FeatureGeometry,
  type FeatureStyle,
  type GeometryFeature,
  type JsonValue,
  type Layer,
  type Point2D,
} from "../domain/geometryFeature";
import type { DuckDBCapabilities } from "./createDuckDB";

type Row = Record<string, unknown>;
type InsertConflictPolicy = "error" | "ignore" | "replace";

export const CURRENT_SCHEMA_VERSION = 3;

export class PersistenceCheckpointError extends Error {
  constructor(cause: unknown) {
    super(`OPFS write succeeded, but CHECKPOINT failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = "PersistenceCheckpointError";
  }
}

export interface JsonFeatureRow extends Row {
  id: unknown;
  geom_type: unknown;
  coordinates: unknown;
  properties: unknown;
  style: unknown;
  layer_id: unknown;
  created_at: unknown;
}

export interface LegacyJsonRow extends Row {
  id: unknown;
  coords: unknown;
  color: unknown;
  width: unknown;
  geom_type: unknown;
  created_at: unknown;
}

const stringValue = (value: unknown): string => (value == null ? "" : String(value));
const jsonValue = <T>(value: unknown): T => JSON.parse(stringValue(value)) as T;
const isValidTimestamp = (value: unknown): boolean => {
  if (value instanceof Date) return Number.isFinite(value.valueOf());
  const text = stringValue(value).trim();
  return text.length > 0 && Number.isFinite(Date.parse(text));
};
const isoTimestamp = (value: unknown): string => {
  if (!isValidTimestamp(value)) return new Date().toISOString();
  return (value instanceof Date ? value : new Date(stringValue(value))).toISOString();
};

const geometryFromParts = (type: unknown, coordinates: unknown): FeatureGeometry => {
  const rawType = stringValue(type);
  if (rawType !== "LineString" && rawType !== "line" && rawType !== "Polygon" && rawType !== "polygon") {
    throw new Error(`Unsupported geometry type: ${rawType}`);
  }
  const geometry = {
    type: rawType === "Polygon" || rawType === "polygon" ? "Polygon" : "LineString",
    coordinates: coordinates as Point2D[],
  } as FeatureGeometry;
  if (!isFeatureGeometry(geometry)) throw new Error("Invalid geometry row");
  return geometry;
};

const geometryFromGeoJson = (value: unknown): FeatureGeometry => {
  const parsed = jsonValue<{ type: string; coordinates: Point2D[] | Point2D[][] }>(value);
  if (parsed.type === "Polygon") {
    if (!Array.isArray(parsed.coordinates)) throw new Error("Invalid Polygon coordinates");
    if (parsed.coordinates.length > 1) throw new Error("Polygon holes are not supported");
    if (parsed.coordinates.length !== 1 || !Array.isArray(parsed.coordinates[0])) {
      throw new Error("Invalid Polygon coordinates");
    }
  }
  const coordinates =
    parsed.type === "Polygon" ? (parsed.coordinates[0] as Point2D[]) : (parsed.coordinates as Point2D[]);
  const openCoordinates =
    parsed.type === "Polygon" &&
    coordinates.length > 1 &&
    coordinates[0][0] === coordinates.at(-1)?.[0] &&
    coordinates[0][1] === coordinates.at(-1)?.[1]
      ? coordinates.slice(0, -1)
      : coordinates;
  return geometryFromParts(parsed.type, openCoordinates);
};

export const mapJsonFeatureRow = (row: JsonFeatureRow): GeometryFeature => ({
  id: stringValue(row.id),
  geometry: geometryFromParts(row.geom_type, jsonValue<Point2D[]>(row.coordinates)),
  properties: jsonValue<Record<string, JsonValue>>(row.properties),
  style: jsonValue<FeatureStyle>(row.style),
  layerId: stringValue(row.layer_id),
  createdAt: isoTimestamp(row.created_at),
});

export const mapLegacyJsonRow = (row: LegacyJsonRow): GeometryFeature => ({
  id: stringValue(row.id),
  geometry: geometryFromParts(row.geom_type, jsonValue<Point2D[]>(row.coords)),
  properties: {},
  style: createDefaultStyle(stringValue(row.color) || "#222222", Number(row.width) || 4),
  layerId: DEFAULT_LAYER_ID,
  createdAt: isoTimestamp(row.created_at),
});

export const mergeLegacyFeatures = (
  jsonFeatures: GeometryFeature[],
  spatialFeatures: GeometryFeature[]
): GeometryFeature[] => {
  const features = new Map(jsonFeatures.map((feature) => [feature.id, feature]));
  for (const feature of spatialFeatures) features.set(feature.id, feature);
  return [...features.values()];
};

export const mapSpatialFeatureRow = (row: Row): GeometryFeature => ({
  id: stringValue(row.id),
  geometry: geometryFromGeoJson(row.geometry),
  properties: jsonValue<Record<string, JsonValue>>(row.properties),
  style: jsonValue<FeatureStyle>(row.style),
  layerId: stringValue(row.layer_id),
  createdAt: isoTimestamp(row.created_at),
});

const geometryToWkt = (geometry: FeatureGeometry): string => {
  const points =
    geometry.type === "Polygon" ? [...geometry.coordinates, geometry.coordinates[0]] : geometry.coordinates;
  const body = points.map(([x, y]) => `${x} ${y}`).join(", ");
  return geometry.type === "Polygon" ? `POLYGON((${body}))` : `LINESTRING(${body})`;
};

export class GeometryRepository {
  private readonly connection: AsyncDuckDBConnection;
  private readonly capabilities: DuckDBCapabilities;

  constructor(connection: AsyncDuckDBConnection, capabilities: DuckDBCapabilities) {
    this.connection = connection;
    this.capabilities = capabilities;
  }

  async initialize(): Promise<{ migrationWarning?: string }> {
    await this.connection.query(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const previousSchemaVersion = await this.initializeSchemaVersion();
    await this.connection.query(`
      CREATE TABLE IF NOT EXISTS layers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visible BOOLEAN NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL
      );
    `);
    if (this.capabilities.store === "spatial") {
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS features (
          id TEXT PRIMARY KEY,
          geom GEOMETRY NOT NULL,
          properties JSON NOT NULL,
          style JSON NOT NULL,
          layer_id TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL,
          inserted_at TIMESTAMP NOT NULL DEFAULT now(),
          insertion_order BIGINT NOT NULL
        );
      `);
    } else {
      await this.connection.query(`
        CREATE TABLE IF NOT EXISTS features_json (
          id TEXT PRIMARY KEY,
          geom_type TEXT NOT NULL,
          coordinates JSON NOT NULL,
          properties JSON NOT NULL,
          style JSON NOT NULL,
          layer_id TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL,
          inserted_at TIMESTAMP NOT NULL DEFAULT now(),
          insertion_order BIGINT NOT NULL
        );
      `);
    }
    if (previousSchemaVersion === 1) {
      const table = this.capabilities.store === "spatial" ? "features" : "features_json";
      await this.connection.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMP DEFAULT now();`);
    }
    if (previousSchemaVersion === 1 || previousSchemaVersion === 2) {
      const table = this.capabilities.store === "spatial" ? "features" : "features_json";
      await this.connection.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS insertion_order BIGINT;`);
      await this.connection.query(`
        UPDATE ${table}
        SET insertion_order = ordered.row_number
        FROM (
          SELECT id, ROW_NUMBER() OVER (ORDER BY inserted_at ASC, id ASC) AS row_number
          FROM ${table}
        ) AS ordered
        WHERE ${table}.id = ordered.id AND ${table}.insertion_order IS NULL;
      `);
      await this.connection.query(`ALTER TABLE ${table} ALTER COLUMN insertion_order SET NOT NULL;`);
      await this.setMetadata("schema_version", String(CURRENT_SCHEMA_VERSION));
    }
    await this.initializeActiveStore();
    await this.insertLayers([DEFAULT_LAYER], true);

    await this.connection.query("BEGIN TRANSACTION;");
    let committed = false;
    let skippedRows = 0;
    let replacedCreatedAtValues = 0;
    const diagnostics: string[] = [];
    try {
      const migrated = (await this.metadataValue("legacy_strokes_migrated")) === "true";
      if (!migrated) {
        const tables = await this.legacyTables();
        let jsonMigrated = (await this.metadataValue("legacy_strokes_json_migrated")) === "true";
        let spatialMigrated = (await this.metadataValue("legacy_strokes_spatial_migrated")) === "true";
        if (!jsonMigrated && tables.has("strokes_json")) {
          const rows = await this.connection.query(
            "SELECT id, coords, color, width, geom_type, created_at FROM strokes_json ORDER BY created_at ASC;"
          );
          for (const row of rows.toArray()) {
            try {
              const value = row.toJSON() as LegacyJsonRow;
              const feature = mapLegacyJsonRow(value);
              if (!isValidTimestamp(value.created_at)) replacedCreatedAtValues += 1;
              await this.insertFeature(feature, "ignore", true);
            } catch {
              skippedRows += 1;
            }
          }
        }
        if (!jsonMigrated) {
          await this.setMetadata("legacy_strokes_json_migrated", "true");
          jsonMigrated = true;
        }
        const spatialMigrationPending = !spatialMigrated && tables.has("strokes") && !this.capabilities.spatial;
        if (!spatialMigrated && tables.has("strokes") && this.capabilities.spatial) {
          const rows = await this.connection.query(
            "SELECT id, ST_AsGeoJSON(geom) AS geometry, color, width, geom_type, created_at FROM strokes ORDER BY created_at ASC;"
          );
          for (const row of rows.toArray()) {
            try {
              const value = row.toJSON() as Row;
              const feature: GeometryFeature = {
                id: stringValue(value.id),
                geometry: geometryFromGeoJson(value.geometry),
                properties: {},
                style: createDefaultStyle(stringValue(value.color) || "#222222", Number(value.width) || 4),
                layerId: DEFAULT_LAYER_ID,
                createdAt: isoTimestamp(value.created_at),
              };
              if (!isValidTimestamp(value.created_at)) replacedCreatedAtValues += 1;
              await this.insertFeature(feature, "replace", true);
            } catch {
              skippedRows += 1;
            }
          }
        }
        if (!spatialMigrated && !spatialMigrationPending) {
          await this.setMetadata("legacy_strokes_spatial_migrated", "true");
          spatialMigrated = true;
        }
        if (jsonMigrated && spatialMigrated) {
          await this.setMetadata("legacy_strokes_migrated", "true");
        }
        if (spatialMigrationPending) {
          diagnostics.push("Legacy Spatial stroke migration is pending until the Spatial extension is available.");
        }
      }
      await this.connection.query("COMMIT;");
      committed = true;
      await this.checkpoint();
      if (skippedRows) {
        diagnostics.push(
          `Legacy stroke migration skipped ${skippedRows} invalid ${skippedRows === 1 ? "row" : "rows"}.`
        );
      }
      if (replacedCreatedAtValues) {
        diagnostics.push(
          `Legacy stroke migration replaced ${replacedCreatedAtValues} invalid created_at ${
            replacedCreatedAtValues === 1 ? "value" : "values"
          }.`
        );
      }
      return diagnostics.length ? { migrationWarning: diagnostics.join(" ") } : {};
    } catch (error) {
      if (committed) {
        return {
          migrationWarning: error instanceof Error ? error.message : String(error),
        };
      }
      try {
        await this.connection.query("ROLLBACK;");
      } catch {
        // Preserve the migration failure; rollback is best-effort.
      }
      return {
        migrationWarning: `Legacy stroke migration failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async listFeatures(): Promise<GeometryFeature[]> {
    if (this.capabilities.store === "spatial") {
      const rows = await this.connection.query(
        "SELECT id, ST_AsGeoJSON(geom) AS geometry, properties, style, layer_id, created_at FROM features ORDER BY created_at ASC;"
      );
      return rows.toArray().map((row) => mapSpatialFeatureRow(row.toJSON() as Row));
    }
    const rows = await this.connection.query(
      "SELECT id, geom_type, coordinates, properties, style, layer_id, created_at FROM features_json ORDER BY created_at ASC;"
    );
    return rows.toArray().map((row) => mapJsonFeatureRow(row.toJSON() as JsonFeatureRow));
  }

  async insertFeature(
    feature: GeometryFeature,
    conflictPolicy: InsertConflictPolicy = "error",
    deferCheckpoint = false
  ): Promise<void> {
    await this.assertLayerExists(feature.layerId);
    const insertionOrder = await this.nextInsertionOrder();
    const conflict =
      conflictPolicy === "ignore"
        ? " ON CONFLICT DO NOTHING"
        : conflictPolicy === "replace"
          ? this.capabilities.store === "spatial"
            ? ` ON CONFLICT (id) DO UPDATE SET
                 geom = EXCLUDED.geom,
                 properties = EXCLUDED.properties,
                 style = EXCLUDED.style,
                 layer_id = EXCLUDED.layer_id,
                 created_at = EXCLUDED.created_at`
            : ` ON CONFLICT (id) DO UPDATE SET
                 geom_type = EXCLUDED.geom_type,
                 coordinates = EXCLUDED.coordinates,
                 properties = EXCLUDED.properties,
                 style = EXCLUDED.style,
                 layer_id = EXCLUDED.layer_id,
                 created_at = EXCLUDED.created_at`
          : "";
    const sql =
      this.capabilities.store === "spatial"
        ? `INSERT INTO features(id, geom, properties, style, layer_id, created_at, insertion_order)
           VALUES (?, ST_GeomFromText(CAST(? AS VARCHAR)), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS TIMESTAMP), ?)${conflict};`
        : `INSERT INTO features_json(id, geom_type, coordinates, properties, style, layer_id, created_at, insertion_order)
           VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS TIMESTAMP), ?)${conflict};`;
    const statement = await this.connection.prepare(sql);
    try {
      if (this.capabilities.store === "spatial") {
        await statement.query(
          feature.id,
          geometryToWkt(feature.geometry),
          JSON.stringify(feature.properties),
          JSON.stringify(feature.style),
          feature.layerId,
          feature.createdAt,
          insertionOrder
        );
      } else {
        await statement.query(
          feature.id,
          feature.geometry.type,
          JSON.stringify(feature.geometry.coordinates),
          JSON.stringify(feature.properties),
          JSON.stringify(feature.style),
          feature.layerId,
          feature.createdAt,
          insertionOrder
        );
      }
    } finally {
      await statement.close();
    }
    if (!deferCheckpoint) await this.checkpoint();
  }

  async updateGeometry(id: string, geometry: FeatureGeometry): Promise<void> {
    await this.assertFeatureLayerExists(id);
    if (this.capabilities.store === "spatial") {
      const statement = await this.connection.prepare(
        "UPDATE features SET geom = ST_GeomFromText(CAST(? AS VARCHAR)) WHERE id = ?;"
      );
      try {
        await statement.query(geometryToWkt(geometry), id);
      } finally {
        await statement.close();
      }
    } else {
      const statement = await this.connection.prepare(
        "UPDATE features_json SET geom_type = ?, coordinates = CAST(? AS JSON) WHERE id = ?;"
      );
      try {
        await statement.query(geometry.type, JSON.stringify(geometry.coordinates), id);
      } finally {
        await statement.close();
      }
    }
    await this.checkpoint();
  }

  async deleteLatestFeature(): Promise<void> {
    const table = this.capabilities.store === "spatial" ? "features" : "features_json";
    await this.connection.query(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} ORDER BY insertion_order DESC, id DESC LIMIT 1);`
    );
    await this.checkpoint();
  }

  async clearFeatures(): Promise<void> {
    await this.connection.query(`DELETE FROM ${this.capabilities.store === "spatial" ? "features" : "features_json"};`);
    await this.checkpoint();
  }

  async listLayers(): Promise<Layer[]> {
    const rows = await this.connection.query(
      "SELECT id, name, visible, sort_order, created_at FROM layers ORDER BY sort_order ASC, created_at ASC;"
    );
    return rows.toArray().map((row) => {
      const value = row.toJSON() as Row;
      return {
        id: stringValue(value.id),
        name: stringValue(value.name),
        visible: Boolean(value.visible),
        order: Number(value.sort_order),
        createdAt: isoTimestamp(value.created_at),
      };
    });
  }

  async insertLayers(layers: Layer[], deferCheckpoint = false): Promise<void> {
    const statement = await this.connection.prepare(
      `INSERT INTO layers(id, name, visible, sort_order, created_at)
       VALUES (?, ?, ?, ?, CAST(? AS TIMESTAMP)) ON CONFLICT DO NOTHING;`
    );
    try {
      for (const layer of layers) {
        await statement.query(layer.id, layer.name, layer.visible, layer.order, layer.createdAt);
      }
    } finally {
      await statement.close();
    }
    if (!deferCheckpoint) await this.checkpoint();
  }

  async importGeoJSON(layers: Layer[], features: GeometryFeature[]): Promise<void> {
    await this.connection.query("BEGIN TRANSACTION;");
    try {
      await this.insertLayers(layers, true);
      for (const feature of features) await this.insertFeature(feature, "error", true);
      await this.connection.query("COMMIT;");
    } catch (error) {
      try {
        await this.connection.query("ROLLBACK;");
      } catch {
        // Preserve the import failure; rollback is best-effort.
      }
      throw error;
    }
    await this.checkpoint();
  }

  private async checkpoint(): Promise<void> {
    if (!this.capabilities.opfs) return;
    try {
      await this.connection.query("CHECKPOINT;");
    } catch (error) {
      throw new PersistenceCheckpointError(error);
    }
  }

  private async nextInsertionOrder(): Promise<number> {
    const table = this.capabilities.store === "spatial" ? "features" : "features_json";
    const rows = await this.connection.query(
      `SELECT COALESCE(MAX(insertion_order), 0) + 1 AS next_order FROM ${table};`
    );
    const row = rows.toArray()[0]?.toJSON() as Row | undefined;
    return Number(row?.next_order ?? 1);
  }

  private async initializeSchemaVersion(): Promise<number> {
    const stored = await this.metadataValue("schema_version");
    if (stored === undefined) {
      await this.setMetadata("schema_version", String(CURRENT_SCHEMA_VERSION));
      return CURRENT_SCHEMA_VERSION;
    }
    const version = Number(stored);
    if (!Number.isInteger(version) || version < 0) {
      throw new Error(`Unsupported schema version: ${stored}`);
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported future schema version ${version}; this app supports up to ${CURRENT_SCHEMA_VERSION}.`
      );
    }
    if (version === 0) {
      await this.setMetadata("schema_version", String(CURRENT_SCHEMA_VERSION));
      return CURRENT_SCHEMA_VERSION;
    }
    if (version === 1 || version === 2) return version;
    if (version !== CURRENT_SCHEMA_VERSION) throw new Error(`Unsupported schema version: ${version}`);
    return version;
  }

  private async initializeActiveStore(): Promise<void> {
    const stored = await this.metadataValue("active_feature_store");
    if (stored === undefined) {
      await this.insertMetadataIfAbsent("active_feature_store", this.capabilities.store);
      return;
    }
    if (stored !== "spatial" && stored !== "json") {
      throw new Error(`Unsupported active feature store: ${stored}`);
    }
    if (stored !== this.capabilities.store) {
      throw new Error(
        `Active feature store mismatch: database uses ${stored}, but runtime selected ${this.capabilities.store}.`
      );
    }
  }

  private async assertLayerExists(layerId: string): Promise<void> {
    const statement = await this.connection.prepare("SELECT 1 AS present FROM layers WHERE id = ? LIMIT 1;");
    try {
      if ((await statement.query(layerId)).toArray().length === 0) {
        throw new Error(`Layer "${layerId}" does not exist`);
      }
    } finally {
      await statement.close();
    }
  }

  private async assertFeatureLayerExists(id: string): Promise<void> {
    const table = this.capabilities.store === "spatial" ? "features" : "features_json";
    const statement = await this.connection.prepare(
      `SELECT 1 AS present FROM ${table} AS feature
       INNER JOIN layers AS layer ON layer.id = feature.layer_id
       WHERE feature.id = ? LIMIT 1;`
    );
    try {
      if ((await statement.query(id)).toArray().length === 0) {
        throw new Error(`Feature "${id}" does not reference an existing layer`);
      }
    } finally {
      await statement.close();
    }
  }

  private async legacyTables(): Promise<Set<string>> {
    const statement = await this.connection.prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?, ?);"
    );
    try {
      const rows = await statement.query("main", "strokes", "strokes_json");
      return new Set(rows.toArray().map((row) => stringValue((row.toJSON() as Row).table_name)));
    } finally {
      await statement.close();
    }
  }

  private async metadataValue(key: string): Promise<string | undefined> {
    const statement = await this.connection.prepare("SELECT value FROM app_metadata WHERE key = ?;");
    try {
      const rows = (await statement.query(key)).toArray();
      return rows.length ? stringValue((rows[0].toJSON() as Row).value) : undefined;
    } finally {
      await statement.close();
    }
  }

  private async setMetadata(key: string, value: string): Promise<void> {
    const statement = await this.connection.prepare(
      "INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value;"
    );
    try {
      await statement.query(key, value);
    } finally {
      await statement.close();
    }
  }

  private async insertMetadataIfAbsent(key: string, value: string): Promise<void> {
    const statement = await this.connection.prepare(
      "INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT DO NOTHING;"
    );
    try {
      await statement.query(key, value);
    } finally {
      await statement.close();
    }
  }
}
