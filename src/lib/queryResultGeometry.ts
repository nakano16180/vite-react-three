import type { QueryResult } from "../db/queryRuntime";
import {
  createGeometryFeature,
  isFeatureGeometry,
  type FeatureGeometry,
  type Point2D,
} from "../domain/geometryFeature";
import { toRenderableStroke, type RenderableStroke } from "../domain/renderableStroke";

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

export const queryResultStrokes = (result: QueryResult): RenderableStroke[] => {
  const geometryColumn = result.columns.find((column) => column.geometryRole === "geojson");
  if (!geometryColumn) return [];
  return result.rows.flatMap((row, index) => {
    const geometry = parseGeometry(row[geometryColumn.name]);
    if (!geometry) return [];
    return [
      toRenderableStroke(
        createGeometryFeature({
          id: `query-result-${index}`,
          geometry,
          style: { strokeColor: "#ec4899", strokeWidth: 5, fillColor: "#f9a8d4", fillOpacity: 0.18 },
          layerId: "__query_result__",
        })
      ),
    ];
  });
};
