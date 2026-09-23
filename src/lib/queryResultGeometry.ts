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
import { persistentSelection, temporarySelection, type SelectionIdentity } from "./selection";

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
  featureId?: string;
}

const featureIdColumn = (result: QueryResult): string | undefined =>
  result.columns.find((column) => column.name.toLowerCase() === "id")?.name;

const rowValue = (row: Record<string, unknown>, columnName: string): unknown => Reflect.get(row, columnName);

export const queryResultGeometries = (result: QueryResult): QueryResultGeometry[] => {
  const geometryColumn = result.columns.find((column) => column.geometryRole === "geojson");
  if (!geometryColumn) return [];
  const idColumn = featureIdColumn(result);
  return result.rows.flatMap((row, rowIndex) => {
    const geometry = parseGeometry(rowValue(row, geometryColumn.name));
    if (!geometry) return [];
    const properties = Object.fromEntries(
      result.columns
        .filter((column) => column.name !== geometryColumn.name)
        .map((column) => [column.name, toJsonValue(rowValue(row, column.name))])
    );
    const idValue = idColumn ? rowValue(row, idColumn) : undefined;
    const featureId = typeof idValue === "string" ? idValue : undefined;
    return [{ rowIndex, geometry, properties, ...(featureId ? { featureId } : {}) }];
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

interface QueryResultStrokeOptions {
  renderOrder?: number;
  temporaryQueryKey?: string;
  persistentFeatureIds?: ReadonlySet<string>;
}

const normalizeStrokeOptions = (options?: number | QueryResultStrokeOptions): QueryResultStrokeOptions =>
  typeof options === "number" ? { renderOrder: options } : (options ?? {});

export const queryResultSelectionIdentities = (
  result: QueryResult,
  queryKey: string,
  persistentFeatureIds: ReadonlySet<string>
): Map<number, SelectionIdentity> => {
  const identities = new Map<number, SelectionIdentity>();
  const geometryRows = new Set(queryResultGeometries(result).map(({ rowIndex }) => rowIndex));
  const idColumn = featureIdColumn(result);
  for (const [rowIndex, row] of result.rows.entries()) {
    const idValue = idColumn ? rowValue(row, idColumn) : undefined;
    const featureId = typeof idValue === "string" ? idValue : undefined;
    if (featureId && persistentFeatureIds.has(featureId)) identities.set(rowIndex, persistentSelection(featureId));
    else if (geometryRows.has(rowIndex)) identities.set(rowIndex, temporarySelection(queryKey, rowIndex));
  }
  return identities;
};

export const queryResultStrokes = (
  result: QueryResult,
  options?: number | QueryResultStrokeOptions
): RenderableStroke[] => {
  const normalized = normalizeStrokeOptions(options);
  return queryResultGeometries(result).map(({ rowIndex, geometry, properties, featureId }) =>
    (() => {
      const stroke = toRenderableStroke(
        createGeometryFeature({
          id: `query-result-${rowIndex}`,
          geometry,
          properties,
          style: QUERY_RESULT_STYLE,
          layerId: "__query_result__",
        }),
        normalized.renderOrder
      );
      if (!normalized.temporaryQueryKey) return stroke;
      const identity =
        featureId && normalized.persistentFeatureIds?.has(featureId)
          ? persistentSelection(featureId)
          : temporarySelection(normalized.temporaryQueryKey, rowIndex);
      return { ...stroke, selectionIdentity: identity };
    })()
  );
};
