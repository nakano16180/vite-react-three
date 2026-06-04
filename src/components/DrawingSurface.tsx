import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";

interface DrawingSurfaceProps {
  onFinish: (ptsPx: [number, number][], type: "line" | "polygon") => void | Promise<void>;
  color: string;
  width: number;
  enabled: boolean;
}

export function DrawingSurface({ onFinish, color, width, enabled }: DrawingSurfaceProps) {
  const { size, viewport } = useThree();
  const [currentPtsWorld, setCurrentPtsWorld] = useState<[number, number, number][]>([]);
  const [hoverWorld, setHoverWorld] = useState<[number, number, number] | null>(null);
  const currentPtsPxRef = useRef<[number, number][]>([]);

  const worldToPx = (wx: number, wy: number): [number, number] => {
    const x = ((wx + viewport.width / 2) / viewport.width) * size.width;
    const y = ((viewport.height / 2 - wy) / viewport.height) * size.height;
    return [x, y];
  };

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
    const type = ptsPx.length >= 3 && Math.hypot(endX - startX, endY - startY) <= 20 ? "polygon" : "line";
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

  const onClick = (e: { stopPropagation: () => void; point: { x: number; y: number; z: number } }) => {
    if (!enabled) return;
    e.stopPropagation();
    const p = e.point;
    currentPtsPxRef.current = [...currentPtsPxRef.current, worldToPx(p.x, p.y)];
    setCurrentPtsWorld((prev) => [...prev, [p.x, p.y, 0]]);
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
  const previewLine = enabled && lastPt && hoverWorld ? [lastPt, hoverWorld] : null;

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
