import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { FeatureGeometry, GeometryFeature, Layer, Point2D } from "../domain/geometryFeature";

export const QUERY_FEATURES_VIEW = "geometry_features";
export const QUERY_LAYERS_VIEW = "geometry_layers";

export interface QuerySnapshot {
  features: GeometryFeature[];
  layers: Layer[];
}

const closePolygon = (coordinates: Point2D[]): Point2D[] => [
  ...coordinates.map(([x, y]) => [x, y] as Point2D),
  [...coordinates[0]] as Point2D,
];

const geometryGeoJson = (geometry: FeatureGeometry): string =>
  JSON.stringify(
    geometry.type === "Polygon"
      ? { type: geometry.type, coordinates: [closePolygon(geometry.coordinates)] }
      : { type: geometry.type, coordinates: geometry.coordinates }
  );

export const initializeQueryViews = async (
  connection: AsyncDuckDBConnection,
  { features, layers }: QuerySnapshot
): Promise<void> => {
  await connection.query("BEGIN TRANSACTION;");
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS query_snapshot_features (
        id VARCHAR NOT NULL,
        geometry_type VARCHAR NOT NULL,
        geometry_geojson VARCHAR NOT NULL,
        properties JSON NOT NULL,
        style JSON NOT NULL,
        layer_id VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL,
        feature_order BIGINT NOT NULL
      );
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS query_snapshot_layers (
        id VARCHAR NOT NULL,
        name VARCHAR NOT NULL,
        visible BOOLEAN NOT NULL,
        layer_order INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL
      );
    `);
    await connection.query("DELETE FROM query_snapshot_features;");
    await connection.query("DELETE FROM query_snapshot_layers;");

    const layerStatement = await connection.prepare(`
      INSERT INTO query_snapshot_layers(id, name, visible, layer_order, created_at)
      VALUES (?, ?, ?, ?, CAST(? AS TIMESTAMP));
    `);
    try {
      for (const layer of layers) {
        await layerStatement.query(layer.id, layer.name, layer.visible, layer.order, layer.createdAt);
      }
    } finally {
      await layerStatement.close();
    }

    const featureStatement = await connection.prepare(`
      INSERT INTO query_snapshot_features(
        id,
        geometry_type,
        geometry_geojson,
        properties,
        style,
        layer_id,
        created_at,
        feature_order
      )
      VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS TIMESTAMP), ?);
    `);
    try {
      for (const [index, feature] of features.entries()) {
        await featureStatement.query(
          feature.id,
          feature.geometry.type,
          geometryGeoJson(feature.geometry),
          JSON.stringify(feature.properties),
          JSON.stringify(feature.style),
          feature.layerId,
          feature.createdAt,
          index + 1
        );
      }
    } finally {
      await featureStatement.close();
    }

    await connection.query(`
      CREATE OR REPLACE VIEW ${QUERY_FEATURES_VIEW} AS
      SELECT id, geometry_type, geometry_geojson, properties, style, layer_id, created_at, feature_order
      FROM query_snapshot_features;
    `);
    await connection.query(`
      CREATE OR REPLACE VIEW ${QUERY_LAYERS_VIEW} AS
      SELECT id, name, visible, layer_order, created_at
      FROM query_snapshot_layers;
    `);
    await connection.query("COMMIT;");
  } catch (error) {
    try {
      await connection.query("ROLLBACK;");
    } catch {
      // Preserve the snapshot synchronization failure; rollback is best-effort.
    }
    throw error;
  }
};
