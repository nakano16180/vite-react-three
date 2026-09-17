import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import type { Mesh } from "three";
import {
  getPolygonArea,
  getPolygonPerimeter,
  getPolylineLength,
  isPointInPolygon,
  isPolygonCloseCandidate,
  type Point2D,
} from "../lib/geometry";
import { pointerToModelPixel } from "../lib/canvasCoordinates";
import { drawingOverlayOrder, renderOrderFor, transparentGeometryMaterial } from "../lib/renderOrder";
import type { RenderableStroke } from "../domain/renderableStroke";

interface DrawingSurfaceProps {
  onFinish: (ptsPx: Point2D[], type: "line" | "polygon") => void | Promise<void>;
  color: string;
  width: number;
  enabled: boolean;
  drawingRank: number;
  onCanvasClick?: (additive: boolean) => void;
  selectableStrokes?: RenderableStroke[];
  onSelectStroke?: (stroke: RenderableStroke, additive: boolean) => void;
}

const segmentDistance = (point: Point2D, start: Point2D, end: Point2D): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
};

export function DrawingSurface({
  onFinish,
  color,
  width,
  enabled,
  drawingRank,
  onCanvasClick,
  selectableStrokes = [],
  onSelectStroke,
}: DrawingSurfaceProps) {
  const { camera, size, viewport } = useThree();
  const [currentPtsWorld, setCurrentPtsWorld] = useState<[number, number, number][]>([]);
  const [hoverWorld, setHoverWorld] = useState<[number, number, number] | null>(null);
  const currentPtsPxRef = useRef<Point2D[]>([]);
  const interactionPlaneRef = useRef<Mesh>(null);
  const modifierRef = useRef(false);

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      modifierRef.current = event.ctrlKey || event.metaKey;
    };
    const clearModifier = () => {
      modifierRef.current = false;
    };
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", updateModifier);
    window.addEventListener("blur", clearModifier);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", updateModifier);
      window.removeEventListener("blur", clearModifier);
    };
  }, []);

  const worldToPx = useCallback(
    (wx: number, wy: number): Point2D => {
      const x = ((wx + viewport.width / 2) / viewport.width) * size.width;
      const y = ((viewport.height / 2 - wy) / viewport.height) * size.height;
      return [x, y];
    },
    [size.height, size.width, viewport.height, viewport.width]
  );

  const pxToWorld = useCallback(
    (x: number, y: number): [number, number, number] => [
      (x / size.width) * viewport.width - viewport.width / 2,
      viewport.height / 2 - (y / size.height) * viewport.height,
      0,
    ],
    [size.height, size.width, viewport.height, viewport.width]
  );

  // The orthographic camera exposes a larger world area when zoomed out. Keep
  // the transparent hit plane covering that entire visible area so clicks in
  // the newly visible outer region still clear selection and can be measured.
  const planeArgs = useMemo<[number, number]>(
    () => [viewport.width / Math.max(camera.zoom, 0.01), viewport.height / Math.max(camera.zoom, 0.01)],
    [camera.zoom, viewport.height, viewport.width]
  );

  useFrame(() => {
    interactionPlaneRef.current?.position.set(camera.position.x, camera.position.y, -0.001);
  });

  const finishStroke = useCallback(async () => {
    const ptsPx = currentPtsPxRef.current.filter(
      (point, index, points) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]
    );
    currentPtsPxRef.current = [];
    setCurrentPtsWorld([]);
    setHoverWorld(null);

    if (ptsPx.length < 2) return;
    const [startX, startY] = ptsPx[0];
    const [endX, endY] = ptsPx[ptsPx.length - 1];
    const type = ptsPx.length >= 4 && Math.hypot(endX - startX, endY - startY) <= 20 ? "polygon" : "line";
    await onFinish(type === "polygon" ? ptsPx.slice(0, -1) : ptsPx, type);
  }, [onFinish]);

  // Escapeキーでストロークを確定・保存
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      await finishStroke();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, finishStroke]);

  useEffect(() => {
    if (enabled) return;
    currentPtsPxRef.current = [];
    setCurrentPtsWorld([]);
    setHoverWorld(null);
  }, [enabled]);

  const handleSelection = (e: ThreeEvent<MouseEvent>) => {
    if (!enabled) {
      const pointPx = pointerToModelPixel(e.pointer, size, viewport, camera.position, camera.zoom);
      const candidates = selectableStrokes.flatMap((stroke, strokeIndex) => {
        const points = stroke.geomType === "polygon" ? [...stroke.ptsPx, stroke.ptsPx[0]] : stroke.ptsPx;
        const inside = stroke.geomType === "polygon" && isPointInPolygon(pointPx, stroke.ptsPx);
        let edgeDistance = Infinity;
        for (let index = 0; index < points.length - 1; index += 1) {
          edgeDistance = Math.min(edgeDistance, segmentDistance(pointPx, points[index], points[index + 1]));
        }
        const tolerance = Math.max(14, stroke.width / 2) / Math.max(camera.zoom, 0.01);
        const order = stroke.renderOrder ?? 0;
        const hits: { stroke: RenderableStroke; distance: number; renderOrder: number; strokeIndex: number }[] = [];
        if (inside) hits.push({ stroke, distance: 0, renderOrder: renderOrderFor(order, "fill"), strokeIndex });
        if (edgeDistance <= tolerance) {
          hits.push({
            stroke,
            distance: edgeDistance,
            renderOrder: renderOrderFor(order, "outline"),
            strokeIndex,
          });
        }
        return hits;
      });
      const hit = candidates.reduce<(typeof candidates)[number] | null>((nearest, candidate) => {
        if (
          !nearest ||
          candidate.renderOrder > nearest.renderOrder ||
          (candidate.renderOrder === nearest.renderOrder &&
            (candidate.distance < nearest.distance ||
              (candidate.distance === nearest.distance && candidate.strokeIndex >= nearest.strokeIndex)))
        )
          return candidate;
        return nearest;
      }, null);
      if (hit && onSelectStroke) {
        e.stopPropagation();
        onSelectStroke(
          hit.stroke,
          modifierRef.current || e.ctrlKey || e.metaKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey
        );
      } else if (onCanvasClick) {
        e.stopPropagation();
        onCanvasClick(modifierRef.current || e.ctrlKey || e.metaKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey);
      }
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!enabled) {
      handleSelection(e);
      return;
    }
    e.stopPropagation();
    const pointPx = pointerToModelPixel(e.pointer, size, viewport, camera.position, camera.zoom);
    const nextWorld = pxToWorld(pointPx[0], pointPx[1]);
    currentPtsPxRef.current = [...currentPtsPxRef.current, pointPx];
    setCurrentPtsWorld((prev) => [...prev, nextWorld]);
    setHoverWorld(nextWorld);
  };

  const onPointerMove = (e: { pointer: { x: number; y: number } }) => {
    if (!enabled) return;
    const pointPx = pointerToModelPixel(e.pointer, size, viewport, camera.position, camera.zoom);
    setHoverWorld(pxToWorld(pointPx[0], pointPx[1]));
  };

  const onDoubleClick = async (e: { stopPropagation: () => void }) => {
    if (!enabled) return;
    e.stopPropagation();
    await finishStroke();
  };

  // プレビュー線：最後の確定点 → 現在のカーソル位置
  const lastPt = currentPtsWorld[currentPtsWorld.length - 1];
  const hasPreviewTarget = Boolean(
    enabled && lastPt && hoverWorld && Math.hypot(hoverWorld[0] - lastPt[0], hoverWorld[1] - lastPt[1]) > 0.001
  );
  const previewLine = hasPreviewTarget && lastPt && hoverWorld ? [lastPt, hoverWorld] : null;
  const previewPtsPx =
    hasPreviewTarget && hoverWorld && currentPtsPxRef.current.length > 0
      ? [...currentPtsPxRef.current, worldToPx(hoverWorld[0], hoverWorld[1])]
      : [];
  const previewIsPolygon = isPolygonCloseCandidate(previewPtsPx);
  const previewPolygonPts = previewIsPolygon ? previewPtsPx.slice(0, -1) : [];
  const previewLength = previewIsPolygon ? getPolygonPerimeter(previewPolygonPts) : getPolylineLength(previewPtsPx);
  const previewArea = previewIsPolygon ? getPolygonArea(previewPolygonPts) : undefined;

  // 最後の点のハイライト用サイズ
  const dotRadius = Math.max(0.01, (width / Math.max(size.width, size.height)) * viewport.width * 0.8);

  return (
    <group>
      {/* 確定済みの線分 */}
      {enabled && currentPtsWorld.length >= 2 && (
        <Line
          points={currentPtsWorld}
          color={color}
          lineWidth={width}
          renderOrder={drawingOverlayOrder(drawingRank, "outline")}
          {...transparentGeometryMaterial}
        />
      )}
      {/* プレビュー線（半透明） */}
      {previewLine && (
        <Line
          points={previewLine as [number, number, number][]}
          color={color}
          lineWidth={width}
          opacity={0.4}
          renderOrder={drawingOverlayOrder(drawingRank, "outline")}
          {...transparentGeometryMaterial}
        />
      )}
      {hasPreviewTarget && hoverWorld && previewPtsPx.length >= 2 && (
        <Html position={[hoverWorld[0], hoverWorld[1], 0.002]} center style={{ pointerEvents: "none" }}>
          <div
            style={{
              padding: "2px 5px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.85)",
              color: "#333",
              fontSize: 11,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              textAlign: "left",
            }}
          >
            {previewIsPolygon ? (
              <>
                <div>Area: {previewArea?.toFixed(1)} px²</div>
                <div>Perimeter: {previewLength.toFixed(1)} px</div>
              </>
            ) : (
              <div>Length: {previewLength.toFixed(1)} px</div>
            )}
          </div>
        </Html>
      )}
      {/* 最後の点のハイライト */}
      {enabled && lastPt && (
        <mesh position={lastPt} renderOrder={drawingOverlayOrder(drawingRank, "handle")}>
          <circleGeometry args={[dotRadius, 16]} />
          <meshBasicMaterial color={color} {...transparentGeometryMaterial} />
        </mesh>
      )}
      <mesh
        ref={interactionPlaneRef}
        position={[camera.position.x, camera.position.y, -0.001]}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerMove={onPointerMove}
      >
        <planeGeometry args={planeArgs} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
