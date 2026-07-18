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
const isoTimestamp = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(stringValue(value));
  return Number.isNaN(date.valueOf()) ? stringValue(value) : date.toISOString();
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
          created_at TIMESTAMP NOT NULL
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
          created_at TIMESTAMP NOT NULL
        );
      `);
    }
    await this.insertMetadataIfAbsent("active_feature_store", this.capabilities.store);
    await this.insertLayers([DEFAULT_LAYER]);

    await this.connection.query("BEGIN TRANSACTION;");
    try {
      const migrated = await this.metadataValue("legacy_strokes_migrated");
      if (migrated !== "true") {
        const tables = await this.legacyTables();
        const jsonFeatures: GeometryFeature[] = [];
        const spatialFeatures: GeometryFeature[] = [];
        if (tables.has("strokes_json")) {
          const rows = await this.connection.query(
            "SELECT id, coords, color, width, geom_type, created_at FROM strokes_json ORDER BY created_at ASC;"
          );
          for (const row of rows.toArray()) {
            jsonFeatures.push(mapLegacyJsonRow(row.toJSON() as LegacyJsonRow));
          }
        }
        if (tables.has("strokes")) {
          const rows = await this.connection.query(
            "SELECT id, ST_AsGeoJSON(geom) AS geometry, color, width, geom_type, created_at FROM strokes ORDER BY created_at ASC;"
          );
          for (const row of rows.toArray()) {
            const value = row.toJSON() as Row;
            spatialFeatures.push({
              id: stringValue(value.id),
              geometry: geometryFromGeoJson(value.geometry),
              properties: {},
              style: createDefaultStyle(stringValue(value.color) || "#222222", Number(value.width) || 4),
              layerId: DEFAULT_LAYER_ID,
              createdAt: isoTimestamp(value.created_at),
            });
          }
        }
        for (const feature of mergeLegacyFeatures(jsonFeatures, spatialFeatures)) {
          await this.insertFeature(feature, true);
        }
        await this.setMetadata("legacy_strokes_migrated", "true");
      }
      await this.connection.query("COMMIT;");
      return {};
    } catch (error) {
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

  async insertFeature(feature: GeometryFeature, ignoreConflict = false): Promise<void> {
    const conflict = ignoreConflict ? " ON CONFLICT DO NOTHING" : "";
    const sql =
      this.capabilities.store === "spatial"
        ? `INSERT INTO features(id, geom, properties, style, layer_id, created_at)
           VALUES (?, ST_GeomFromText(CAST(? AS VARCHAR)), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS TIMESTAMP))${conflict};`
        : `INSERT INTO features_json(id, geom_type, coordinates, properties, style, layer_id, created_at)
           VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS TIMESTAMP))${conflict};`;
    const statement = await this.connection.prepare(sql);
    try {
      if (this.capabilities.store === "spatial") {
        await statement.query(
          feature.id,
          geometryToWkt(feature.geometry),
          JSON.stringify(feature.properties),
          JSON.stringify(feature.style),
          feature.layerId,
          feature.createdAt
        );
      } else {
        await statement.query(
          feature.id,
          feature.geometry.type,
          JSON.stringify(feature.geometry.coordinates),
          JSON.stringify(feature.properties),
          JSON.stringify(feature.style),
          feature.layerId,
          feature.createdAt
        );
      }
    } finally {
      await statement.close();
    }
  }

  async updateGeometry(id: string, geometry: FeatureGeometry): Promise<void> {
    if (this.capabilities.store === "spatial") {
      const statement = await this.connection.prepare(
        "UPDATE features SET geom = ST_GeomFromText(CAST(? AS VARCHAR)) WHERE id = ?;"
      );
      try {
        await statement.query(geometryToWkt(geometry), id);
      } finally {
        await statement.close();
      }
      return;
    }
    const statement = await this.connection.prepare(
      "UPDATE features_json SET geom_type = ?, coordinates = CAST(? AS JSON) WHERE id = ?;"
    );
    try {
      await statement.query(geometry.type, JSON.stringify(geometry.coordinates), id);
    } finally {
      await statement.close();
    }
  }

  async deleteLatestFeature(): Promise<void> {
    const table = this.capabilities.store === "spatial" ? "features" : "features_json";
    await this.connection.query(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} ORDER BY created_at DESC, id DESC LIMIT 1);`
    );
  }

  async clearFeatures(): Promise<void> {
    await this.connection.query(`DELETE FROM ${this.capabilities.store === "spatial" ? "features" : "features_json"};`);
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

  async insertLayers(layers: Layer[]): Promise<void> {
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
