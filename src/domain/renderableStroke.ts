import type { FeatureGeometry, GeometryFeature, Point2D } from "./geometryFeature";
import { getPolygonArea, getPolygonPerimeter, getPolylineLength } from "../lib/geometry";

export interface RenderableStroke {
  id: string;
  color: string;
  width: number;
  ptsPx: Point2D[];
  geomType: "line" | "polygon";
  length?: number;
  area?: number;
  perimeter?: number;
}

const copyPoint = ([x, y]: Point2D): Point2D => [x, y];

const squaredSegmentDistance = ([x, y]: Point2D, [x1, y1]: Point2D, [x2, y2]: Point2D): number => {
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (dx !== 0 || dy !== 0) {
    const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x1 = x2;
      y1 = y2;
    } else if (t > 0) {
      x1 += dx * t;
      y1 += dy * t;
    }
  }
  dx = x - x1;
  dy = y - y1;
  return dx * dx + dy * dy;
};

const simplifyDouglasPeucker = (points: Point2D[], tolerance: number): Point2D[] => {
  if (points.length <= 2) return points.map(copyPoint);
  const threshold = tolerance * tolerance;
  let furthestIndex = -1;
  let furthestDistance = threshold;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = squaredSegmentDistance(points[index], points[0], points[points.length - 1]);
    if (distance > furthestDistance) {
      furthestIndex = index;
      furthestDistance = distance;
    }
  }
  if (furthestIndex === -1) return [copyPoint(points[0]), copyPoint(points[points.length - 1])];
  const left = simplifyDouglasPeucker(points.slice(0, furthestIndex + 1), tolerance);
  const right = simplifyDouglasPeucker(points.slice(furthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
};

export const simplifyFeatureGeometry = (geometry: FeatureGeometry, tolerance: number): FeatureGeometry => {
  const copied = geometry.coordinates.map(copyPoint);
  if (tolerance <= 0) return { type: geometry.type, coordinates: copied } as FeatureGeometry;

  const simplified = simplifyDouglasPeucker(copied, tolerance);
  if (geometry.type === "LineString") {
    return { type: "LineString", coordinates: simplified };
  }
  if (simplified.length >= 3) return { type: "Polygon", coordinates: simplified };

  let furthestIndex = 1;
  let furthestDistance = -1;
  for (let index = 1; index < copied.length - 1; index += 1) {
    const distance = squaredSegmentDistance(copied[index], copied[0], copied[copied.length - 1]);
    if (distance > furthestDistance) {
      furthestIndex = index;
      furthestDistance = distance;
    }
  }
  return {
    type: "Polygon",
    coordinates: [copyPoint(copied[0]), copyPoint(copied[furthestIndex]), copyPoint(copied[copied.length - 1])],
  };
};

export const toRenderableStroke = (feature: GeometryFeature): RenderableStroke => {
  const polygon = feature.geometry.type === "Polygon";
  const ptsPx = feature.geometry.coordinates;
  return {
    id: feature.id,
    color: feature.style.strokeColor,
    width: feature.style.strokeWidth,
    ptsPx,
    geomType: polygon ? "polygon" : "line",
    length: polygon ? undefined : getPolylineLength(ptsPx),
    area: polygon ? getPolygonArea(ptsPx) : undefined,
    perimeter: polygon ? getPolygonPerimeter(ptsPx) : undefined,
  };
};
