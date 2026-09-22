import type { GeometryFeature, JsonValue } from "../domain/geometryFeature";

export type AttributeSortDirection = "ascending" | "descending";

export interface AttributeSort {
  key: string;
  direction: AttributeSortDirection;
}

export const ATTRIBUTE_PROPERTY_PREFIX = "property:";

export const attributePropertyColumnKey = (key: string): string => `${ATTRIBUTE_PROPERTY_PREFIX}${key}`;

const propertyKeyFromColumnKey = (key: string): string =>
  key.startsWith(ATTRIBUTE_PROPERTY_PREFIX) ? key.slice(ATTRIBUTE_PROPERTY_PREFIX.length) : key;

const attributeValue = (feature: GeometryFeature, key: string): JsonValue | undefined =>
  key === "id" ? feature.id : feature.properties[propertyKeyFromColumnKey(key)];

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
};

const valueRank = (value: JsonValue | undefined): number => {
  if (value === undefined || value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  return 4;
};

export const attributeKeys = (features: GeometryFeature[]): string[] =>
  [...new Set(features.flatMap((feature) => Object.keys(feature.properties)))].sort((left, right) =>
    left.localeCompare(right)
  );

export const attributeDisplayValue = (value: JsonValue | undefined): string => {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

export const attributeEditorValue = (value: JsonValue): string => JSON.stringify(value);

export const parseAttributeValue = (draft: string): JsonValue => {
  let value: unknown;
  try {
    value = JSON.parse(draft);
  } catch {
    throw new Error("Enter a valid JSON value (strings need double quotes).");
  }
  if (!isJsonValue(value)) {
    throw new Error("Enter a JSON-safe value.");
  }
  return value;
};

const compareValues = (left: JsonValue | undefined, right: JsonValue | undefined): number => {
  const rankDifference = valueRank(left) - valueRank(right);
  if (rankDifference !== 0) return rankDifference;
  if (left === right) return 0;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  if (typeof left === "number" && typeof right === "number") return left - right;
  return attributeDisplayValue(left).localeCompare(attributeDisplayValue(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export const filterAndSortFeatures = (
  features: GeometryFeature[],
  filters: Record<string, string>,
  sort?: AttributeSort
): GeometryFeature[] => {
  const filtered = features.filter((feature) =>
    Object.entries(filters).every(([key, rawFilter]) => {
      const filter = rawFilter.trim().toLocaleLowerCase();
      if (!filter) return true;
      const value = attributeDisplayValue(attributeValue(feature, key));
      return value.toLocaleLowerCase().includes(filter);
    })
  );
  if (!sort) return filtered;
  return filtered
    .map((feature, index) => ({ feature, index }))
    .sort((left, right) => {
      const compared =
        sort.key === "id"
          ? left.feature.id.localeCompare(right.feature.id, undefined, { numeric: true, sensitivity: "base" })
          : compareValues(attributeValue(left.feature, sort.key), attributeValue(right.feature, sort.key));
      return (sort.direction === "ascending" ? compared : -compared) || left.index - right.index;
    })
    .map(({ feature }) => feature);
};
