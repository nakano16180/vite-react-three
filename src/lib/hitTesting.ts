import type { Point2D } from "../domain/geometryFeature";
import type { RenderableStroke } from "../domain/renderableStroke";
import { isPointInPolygon } from "./geometry";
import { renderOrderFor, type RenderElement } from "./renderOrder";
import { persistentSelection, selectionIdentityKey } from "./selection";

export interface StrokePresentation {
  outlineWidth: number;
  handleWidth: number;
}

export const getStrokePresentation = (width: number, selected: boolean): StrokePresentation => ({
  outlineWidth: selected ? width + 4 : width,
  handleWidth: selected ? Math.max(1, width + 2) : 0,
});

export interface StrokeHitCandidate {
  stroke: RenderableStroke;
  element: RenderElement | "fallback";
  distance: number;
  renderOrder: number;
  strokeIndex: number;
}

const segmentDistance = (point: Point2D, start: Point2D, end: Point2D): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
};

const strokeEdgeDistance = (point: Point2D, stroke: RenderableStroke): number => {
  const points = stroke.geomType === "polygon" ? [...stroke.ptsPx, stroke.ptsPx[0]] : stroke.ptsPx;
  let distance = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    distance = Math.min(distance, segmentDistance(point, points.at(index)!, points.at(index + 1)!));
  }
  return distance;
};

const isSelected = (stroke: RenderableStroke, selectedKeys: ReadonlySet<string>): boolean =>
  selectedKeys.has(selectionIdentityKey(stroke.selectionIdentity ?? persistentSelection(stroke.id)));

const candidateWins = (candidate: StrokeHitCandidate, current: StrokeHitCandidate | null): boolean =>
  !current ||
  candidate.renderOrder > current.renderOrder ||
  (candidate.renderOrder === current.renderOrder &&
    (candidate.distance < current.distance ||
      (candidate.distance === current.distance && candidate.strokeIndex >= current.strokeIndex)));

/**
 * Resolves the same visible elements that Scene paints. Fallback hit areas are
 * considered only when no painted element was hit, so an invisible halo cannot
 * cover a visible line in another layer.
 */
export const resolveStrokeHit = (
  pointPx: Point2D,
  strokes: readonly RenderableStroke[],
  selectedKeys: ReadonlySet<string>,
  zoom = 1
): StrokeHitCandidate | null => {
  const safeZoom = Math.max(zoom, 0.01);
  const painted: StrokeHitCandidate[] = [];
  const fallbacks: StrokeHitCandidate[] = [];

  strokes.forEach((stroke, strokeIndex) => {
    const selected = isSelected(stroke, selectedKeys);
    const presentation = getStrokePresentation(stroke.width, selected);
    const order = stroke.renderOrder ?? 0;
    const edgeDistance = strokeEdgeDistance(pointPx, stroke);
    const edgeDistanceScreen = edgeDistance * safeZoom;
    const interior = stroke.geomType === "polygon" && isPointInPolygon(pointPx, stroke.ptsPx);

    if (interior) {
      painted.push({ stroke, element: "fill", distance: 0, renderOrder: renderOrderFor(order, "fill"), strokeIndex });
    }

    const visibleOutlineHalfWidth = presentation.outlineWidth / 2;
    if (edgeDistanceScreen <= visibleOutlineHalfWidth) {
      const handleHalfWidth = presentation.handleWidth / 2;
      const element: RenderElement = selected && edgeDistanceScreen <= handleHalfWidth ? "handle" : "outline";
      painted.push({
        stroke,
        element,
        distance: edgeDistance,
        renderOrder: renderOrderFor(order, element),
        strokeIndex,
      });
    }

    if (edgeDistanceScreen <= 14) {
      fallbacks.push({
        stroke,
        element: "fallback",
        distance: edgeDistance,
        renderOrder: renderOrderFor(order, "outline"),
        strokeIndex,
      });
    }
  });

  const candidates = painted.length > 0 ? painted : fallbacks;
  return candidates.reduce<StrokeHitCandidate | null>(
    (current, candidate) => (candidateWins(candidate, current) ? candidate : current),
    null
  );
};
