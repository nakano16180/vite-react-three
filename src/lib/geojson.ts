import {
  DEFAULT_LAYER,
  DEFAULT_LAYER_ID,
  createGeometryFeature,
  isFeatureGeometry,
  type FeatureGeometry,
  type FeatureStyle,
  type GeometryFeature,
  type JsonValue,
  type Layer,
  type Point2D,
} from "../domain/geometryFeature";

export interface ImportedGeoJSON {
  features: GeometryFeature[];
  layers: Layer[];
  warnings: string[];
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "LineString"; coordinates: Point2D[] } | { type: "Polygon"; coordinates: Point2D[][] };
    properties: Record<string, JsonValue>;
    workbench: { style: FeatureStyle; layerId: string; createdAt: string };
  }>;
  workbench: { layers: Layer[] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};

const isLayer = (value: unknown): value is Layer =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.visible === "boolean" &&
  typeof value.order === "number" &&
  Number.isFinite(value.order) &&
  typeof value.createdAt === "string";

const isStyle = (value: unknown): value is FeatureStyle =>
  isRecord(value) &&
  typeof value.strokeColor === "string" &&
  typeof value.strokeWidth === "number" &&
  Number.isFinite(value.strokeWidth) &&
  (value.fillColor === undefined || typeof value.fillColor === "string") &&
  (value.fillOpacity === undefined || (typeof value.fillOpacity === "number" && Number.isFinite(value.fillOpacity)));

const copyPoint = ([x, y]: Point2D): Point2D => [x, y];

export const exportFeatureCollection = (features: GeometryFeature[], layers: Layer[]): GeoJSONFeatureCollection => {
  const referencedLayerIds = new Set(features.map((feature) => feature.layerId));
  return {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      type: "Feature",
      id: feature.id,
      geometry:
        feature.geometry.type === "Polygon"
          ? {
              type: "Polygon",
              coordinates: [
                [...feature.geometry.coordinates.map(copyPoint), copyPoint(feature.geometry.coordinates[0])],
              ],
            }
          : {
              type: "LineString",
              coordinates: feature.geometry.coordinates.map(copyPoint),
            },
      properties: { ...feature.properties },
      workbench: {
        style: { ...feature.style },
        layerId: feature.layerId,
        createdAt: feature.createdAt,
      },
    })),
    workbench: { layers: layers.filter((layer) => referencedLayerIds.has(layer.id)).map((layer) => ({ ...layer })) },
  };
};

const canonicalGeometry = (value: unknown): FeatureGeometry | null => {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) return null;
  const candidate =
    value.type === "Polygon" && value.coordinates.length === 1
      ? { type: "Polygon", coordinates: value.coordinates[0] }
      : { type: value.type, coordinates: value.coordinates };
  return isFeatureGeometry(candidate) ? candidate : null;
};

const readProperties = (value: unknown): Record<string, JsonValue> => {
  if (!isRecord(value)) return {};
  const properties: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!["id", "color", "width", "geomType"].includes(key) && isJsonValue(entry)) {
      properties[key] = entry;
    }
  }
  return properties;
};

const uniqueId = (requested: unknown, usedIds: Set<string>): string => {
  let id = typeof requested === "string" && requested.length > 0 ? requested : crypto.randomUUID();
  while (usedIds.has(id)) id = crypto.randomUUID();
  usedIds.add(id);
  return id;
};

export const importFeatureCollection = (
  input: unknown,
  existingIds: ReadonlySet<string> = new Set()
): ImportedGeoJSON => {
  const warnings: string[] = [];
  if (!isRecord(input)) {
    return { features: [], layers: [DEFAULT_LAYER], warnings: ["Input is not a GeoJSON object"] };
  }

  if (input.type === "FeatureCollection" && !Array.isArray(input.features)) {
    warnings.push("FeatureCollection features must be an array");
  }
  const rawFeatures =
    input.type === "FeatureCollection" && Array.isArray(input.features)
      ? input.features
      : input.type === "Feature"
        ? [input]
        : [];
  if (rawFeatures.length === 0 && input.type !== "FeatureCollection") {
    warnings.push("Input is not a GeoJSON Feature or FeatureCollection");
  }

  const rawLayers = isRecord(input.workbench) ? input.workbench.layers : undefined;
  const layers =
    Array.isArray(rawLayers) && rawLayers.length > 0 && rawLayers.every(isLayer)
      ? rawLayers.map((layer) => ({ ...layer }))
      : [DEFAULT_LAYER];
  const layerIds = new Set(layers.map((layer) => layer.id));
  const usedIds = new Set(existingIds);
  const features: GeometryFeature[] = [];

  rawFeatures.forEach((rawFeature, index) => {
    if (!isRecord(rawFeature) || rawFeature.type !== "Feature") {
      warnings.push(`Feature ${index} is not a valid GeoJSON Feature`);
      return;
    }
    const geometry = canonicalGeometry(rawFeature.geometry);
    if (!geometry) {
      warnings.push(`Feature ${index} has unsupported or invalid geometry`);
      return;
    }

    const legacy = isRecord(rawFeature.properties) ? rawFeature.properties : {};
    const metadata = isRecord(rawFeature.workbench) ? rawFeature.workbench : {};
    const style = isStyle(metadata.style)
      ? { ...metadata.style }
      : {
          strokeColor: typeof legacy.color === "string" ? legacy.color : "#222222",
          strokeWidth: typeof legacy.width === "number" && Number.isFinite(legacy.width) ? legacy.width : 4,
        };
    const requestedLayerId =
      typeof metadata.layerId === "string" && layerIds.has(metadata.layerId) ? metadata.layerId : DEFAULT_LAYER_ID;

    features.push(
      createGeometryFeature({
        id: uniqueId(rawFeature.id ?? legacy.id, usedIds),
        geometry,
        properties: readProperties(rawFeature.properties),
        style,
        layerId: requestedLayerId,
        createdAt: typeof metadata.createdAt === "string" ? metadata.createdAt : undefined,
      })
    );
  });

  return { features, layers, warnings };
};
