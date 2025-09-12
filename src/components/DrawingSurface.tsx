import { useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";

interface DrawingSurfaceProps {
  onFinish: (ptsPx: [number, number][]) => void | Promise<void>;
  color: string;
  width: number;
  enabled: boolean;
}

export function DrawingSurface({ onFinish, color, width, enabled }: DrawingSurfaceProps) {
  const { size, viewport } = useThree();
  const [drawing, setDrawing] = useState(false);
  const [previewWorld, setPreviewWorld] = useState<[number, number, number][]>([]);
  const ptsPxRef = useRef<[number, number][]>([]);

  const worldToPx = (wx: number, wy: number): [number, number] => {
    const x = ((wx + viewport.width / 2) / viewport.width) * size.width;
    const y = ((viewport.height / 2 - wy) / viewport.height) * size.height;
    return [x, y];
  };

  // 近すぎる点をスキップして無駄な頂点を減らす
  const MIN_DIST = 1.5; // px

  const planeArgs = useMemo<[number, number]>(() => [viewport.width, viewport.height], [viewport]);

  const onPointerDown = (e: { stopPropagation: () => void; point: { x: number; y: number; z: number } }) => {
    if (!enabled) return;
    e.stopPropagation();
    setDrawing(true);
    const p = e.point;
    setPreviewWorld([[p.x, p.y, 0]]);
    ptsPxRef.current = [worldToPx(p.x, p.y)];
  };

  const onPointerMove = (e: { point: { x: number; y: number; z: number } }) => {
    if (!drawing || !enabled) return;
    const p = e.point;
    const [x, y] = worldToPx(p.x, p.y);
    const last = ptsPxRef.current[ptsPxRef.current.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) >= MIN_DIST) {
      ptsPxRef.current.push([x, y]);
      setPreviewWorld((prev) => [...prev, [p.x, p.y, 0]]);
    }
  };

  const onPointerUp = async () => {
    if (!drawing || !enabled) return;
    setDrawing(false);
    const ptsPx = ptsPxRef.current.slice();
    ptsPxRef.current = [];
    setPreviewWorld([]);
    await onFinish(ptsPx);
  };

  return (
    <group>
      {enabled && previewWorld.length >= 2 && <Line points={previewWorld} color={color} lineWidth={width} />}
      <mesh position={[0, 0, 0]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <planeGeometry args={planeArgs} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
