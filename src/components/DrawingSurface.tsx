import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import {
  getPolygonArea,
  getPolygonPerimeter,
  getPolylineLength,
  isPolygonCloseCandidate,
  type Point2D,
} from "../lib/geometry";

interface DrawingSurfaceProps {
  onFinish: (ptsPx: Point2D[], type: "line" | "polygon") => void | Promise<void>;
  color: string;
  width: number;
  enabled: boolean;
}

export function DrawingSurface({ onFinish, color, width, enabled }: DrawingSurfaceProps) {
  const { size, viewport } = useThree();
  const [currentPtsWorld, setCurrentPtsWorld] = useState<[number, number, number][]>([]);
  const [hoverWorld, setHoverWorld] = useState<[number, number, number] | null>(null);
  const currentPtsPxRef = useRef<Point2D[]>([]);

  const worldToPx = useCallback(
    (wx: number, wy: number): Point2D => {
      const x = ((wx + viewport.width / 2) / viewport.width) * size.width;
      const y = ((viewport.height / 2 - wy) / viewport.height) * size.height;
      return [x, y];
    },
    [size.height, size.width, viewport.height, viewport.width]
  );

  const planeArgs = useMemo<[number, number]>(() => [viewport.width, viewport.height], [viewport]);

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

  const onClick = (e: { stopPropagation: () => void; point: { x: number; y: number; z: number } }) => {
    if (!enabled) return;
    e.stopPropagation();
    const p = e.point;
    const nextWorld: [number, number, number] = [p.x, p.y, 0];
    currentPtsPxRef.current = [...currentPtsPxRef.current, worldToPx(p.x, p.y)];
    setCurrentPtsWorld((prev) => [...prev, nextWorld]);
    setHoverWorld(nextWorld);
  };

  const onPointerMove = (e: { point: { x: number; y: number; z: number } }) => {
    if (!enabled) return;
    setHoverWorld([e.point.x, e.point.y, 0]);
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
      {enabled && currentPtsWorld.length >= 2 && <Line points={currentPtsWorld} color={color} lineWidth={width} />}
      {/* プレビュー線（半透明） */}
      {previewLine && (
        <Line
          points={previewLine as [number, number, number][]}
          color={color}
          lineWidth={width}
          transparent
          opacity={0.4}
        />
      )}
      {hasPreviewTarget && hoverWorld && previewPtsPx.length >= 2 && (
        <Html position={[hoverWorld[0], hoverWorld[1], 0.002]} center>
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
        <mesh position={lastPt}>
          <circleGeometry args={[dotRadius, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
      <mesh position={[0, 0, -0.001]} onClick={onClick} onDoubleClick={onDoubleClick} onPointerMove={onPointerMove}>
        <planeGeometry args={planeArgs} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
