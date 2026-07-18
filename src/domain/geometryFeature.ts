import { createId } from "../lib/id";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Point2D = [number, number];

export type FeatureGeometry =
  | { type: "LineString"; coordinates: Point2D[] }
  | { type: "Polygon"; coordinates: Point2D[] };

export interface FeatureStyle {
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity?: number;
}

export interface GeometryFeature {
  id: string;
  geometry: FeatureGeometry;
  properties: Record<string, JsonValue>;
  style: FeatureStyle;
  layerId: string;
  createdAt: string;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  order: number;
  createdAt: string;
}

export interface CreateGeometryFeatureInput {
  id?: string;
  geometry: FeatureGeometry;
  properties?: Record<string, JsonValue>;
  style?: FeatureStyle;
  layerId?: string;
  createdAt?: string;
}

export const DEFAULT_LAYER_ID = "default";
export const DEFAULT_LAYER: Layer = {
  id: DEFAULT_LAYER_ID,
  name: "Default",
  visible: true,
  order: 0,
  createdAt: "1970-01-01T00:00:00.000Z",
};

export const createDefaultStyle = (strokeColor = "#222222", strokeWidth = 4): FeatureStyle => ({
  strokeColor,
  strokeWidth,
});

const isPoint2D = (value: unknown): value is Point2D =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "number" &&
  Number.isFinite(value[0]) &&
  typeof value[1] === "number" &&
  Number.isFinite(value[1]);

export const isFeatureGeometry = (value: unknown): value is FeatureGeometry => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(candidate.coordinates) || !candidate.coordinates.every(isPoint2D)) return false;
  if (candidate.type === "LineString") return candidate.coordinates.length >= 2;
  if (candidate.type === "Polygon") return candidate.coordinates.length >= 3;
  return false;
};

const normalizeGeometry = (geometry: FeatureGeometry): FeatureGeometry => {
  const coordinates = geometry.coordinates.map(([x, y]) => [x, y] as Point2D);
  if (
    geometry.type === "Polygon" &&
    coordinates.length > 1 &&
    coordinates[0][0] === coordinates.at(-1)?.[0] &&
    coordinates[0][1] === coordinates.at(-1)?.[1]
  ) {
    coordinates.pop();
  }
  const normalized = { type: geometry.type, coordinates } as FeatureGeometry;
  if (!isFeatureGeometry(normalized)) throw new Error("Invalid feature geometry");
  return normalized;
};

export const createGeometryFeature = (input: CreateGeometryFeatureInput): GeometryFeature => ({
  id: input.id ?? createId(),
  geometry: normalizeGeometry(input.geometry),
  properties: input.properties ?? {},
  style: input.style ?? createDefaultStyle(),
  layerId: input.layerId ?? DEFAULT_LAYER_ID,
  createdAt: input.createdAt ?? new Date().toISOString(),
});
