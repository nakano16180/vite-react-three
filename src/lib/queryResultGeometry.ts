import type { QueryResult } from "../db/queryRuntime";
import {
  createGeometryFeature,
  isFeatureGeometry,
  type FeatureGeometry,
  type GeometryFeature,
  type JsonValue,
  type Point2D,
} from "../domain/geometryFeature";
import { toRenderableStroke, type RenderableStroke } from "../domain/renderableStroke";

export const QUERY_RESULT_STYLE = {
  strokeColor: "#ec4899",
  strokeWidth: 5,
  fillColor: "#f9a8d4",
  fillOpacity: 0.18,
} as const;

const parseGeometry = (value: unknown): FeatureGeometry | null => {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as { type?: unknown; coordinates?: unknown };
    if (parsed.type !== "LineString" && parsed.type !== "Polygon") return null;
    const coordinates =
      parsed.type === "Polygon" && Array.isArray(parsed.coordinates) ? parsed.coordinates[0] : parsed.coordinates;
    if (!Array.isArray(coordinates)) return null;
    const open = coordinates.map((point) => point as Point2D);
    if (
      parsed.type === "Polygon" &&
      open.length > 1 &&
      open[0][0] === open.at(-1)?.[0] &&
      open[0][1] === open.at(-1)?.[1]
    )
      open.pop();
    const geometry = { type: parsed.type, coordinates: open } as FeatureGeometry;
    return isFeatureGeometry(geometry) ? geometry : null;
  } catch {
    return null;
  }
};

const toJsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]));
  }
  return String(value);
};

export interface QueryResultGeometry {
  rowIndex: number;
  geometry: FeatureGeometry;
  properties: Record<string, JsonValue>;
}

export const queryResultGeometries = (result: QueryResult): QueryResultGeometry[] => {
  const geometryColumn = result.columns.find((column) => column.geometryRole === "geojson");
  if (!geometryColumn) return [];
  return result.rows.flatMap((row, rowIndex) => {
    const geometry = parseGeometry(row[geometryColumn.name]);
    if (!geometry) return [];
    const properties = Object.fromEntries(
      result.columns
        .filter((column) => column.name !== geometryColumn.name)
        .map((column) => [column.name, toJsonValue(row[column.name])])
    );
    return [{ rowIndex, geometry, properties }];
  });
};

export const queryResultFeatures = (result: QueryResult, layerId: string): GeometryFeature[] =>
  queryResultGeometries(result).map(({ geometry, properties }) =>
    createGeometryFeature({
      geometry,
      properties,
      style: QUERY_RESULT_STYLE,
      layerId,
    })
  );

export const queryResultStrokes = (result: QueryResult): RenderableStroke[] => {
  return queryResultGeometries(result).map(({ rowIndex, geometry, properties }) =>
    toRenderableStroke(
      createGeometryFeature({
        id: `query-result-${rowIndex}`,
        geometry,
        properties,
        style: QUERY_RESULT_STYLE,
        layerId: "__query_result__",
      })
    )
  );
};
