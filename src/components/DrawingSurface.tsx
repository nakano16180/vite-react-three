import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import type { Mesh } from "three";
import {
  getPolygonArea,
  getPolygonPerimeter,
  getPolylineLength,
  isPolygonCloseCandidate,
  type Point2D,
} from "../lib/geometry";
import { pointerToModelPixel } from "../lib/canvasCoordinates";
import { drawingOverlayOrder, transparentGeometryMaterial } from "../lib/renderOrder";
import { selectionIdentityKey, type SelectionIdentity } from "../lib/selection";
import { resolveStrokeHit } from "../lib/hitTesting";
import type { RenderableStroke } from "../domain/renderableStroke";

interface DrawingSurfaceProps {
  onFinish: (ptsPx: Point2D[], type: "line" | "polygon") => void | Promise<void>;
  color: string;
  width: number;
  enabled: boolean;
  drawingRank: number;
  onCanvasClick?: (additive: boolean) => void;
  selectableStrokes?: RenderableStroke[];
  selection?: SelectionIdentity[];
  onSelectStroke?: (stroke: RenderableStroke, additive: boolean) => void;
}

export function DrawingSurface({
  onFinish,
  color,
  width,
  enabled,
  drawingRank,
  onCanvasClick,
  selectableStrokes = [],
  selection = [],
  onSelectStroke,
}: DrawingSurfaceProps) {
  const { camera, size, viewport } = useThree();
  const [currentPtsWorld, setCurrentPtsWorld] = useState<[number, number, number][]>([]);
  const [hoverWorld, setHoverWorld] = useState<[number, number, number] | null>(null);
  const currentPtsPxRef = useRef<Point2D[]>([]);
  const interactionPlaneRef = useRef<Mesh>(null);
  const modifierRef = useRef(false);
  const selectedKeys = useMemo(() => new Set(selection.map(selectionIdentityKey)), [selection]);

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

  useFrame(() => {
    const plane = interactionPlaneRef.current;
    if (!plane) return;
    plane.position.set(camera.position.x, camera.position.y, -0.001);
    const zoom = Math.max(camera.zoom, 0.01);
    plane.scale.set(1 / zoom, 1 / zoom, 1);
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
      const hit = resolveStrokeHit(pointPx, selectableStrokes, selectedKeys, camera.zoom);
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
        <planeGeometry args={[viewport.width, viewport.height]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
