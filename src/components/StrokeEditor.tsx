import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";

interface Stroke {
  id: string;
  color: string;
  width: number;
  ptsPx: [number, number][];
}

interface StrokeEditorProps {
  strokes: Stroke[];
  onUpdateStroke: (strokeId: string, newPtsPx: [number, number][]) => Promise<void>;
  enabled: boolean;
}

export function StrokeEditor({ strokes, onUpdateStroke, enabled }: StrokeEditorProps) {
  const { size, viewport } = useThree();
  const [selected, setSelected] = useState<{ strokeId: string; ptIndex: number } | null>(null);
  const [dragWorld, setDragWorld] = useState<[number, number, number] | null>(null);
  const draggingRef = useRef(false);
  const selectedRef = useRef<{ strokeId: string; ptIndex: number } | null>(null);

  const pxToWorld = (x: number, y: number): [number, number, number] => {
    const wx = (x / size.width) * viewport.width - viewport.width / 2;
    const wy = viewport.height / 2 - (y / size.height) * viewport.height;
    return [wx, wy, 0];
  };

  const worldToPx = (wx: number, wy: number): [number, number] => {
    const x = ((wx + viewport.width / 2) / viewport.width) * size.width;
    const y = ((viewport.height / 2 - wy) / viewport.height) * size.height;
    return [x, y];
  };

  const planeArgs = useMemo<[number, number]>(() => [viewport.width, viewport.height], [viewport]);

  // 点のビジュアルサイズ（8px相当）とヒット判定半径（12px相当）
  const dotRadius = (8 / size.width) * viewport.width;
  const hitRadius = (12 / size.width) * viewport.width;

  // モード切替時に選択・ドラッグ状態をリセット
  useEffect(() => {
    if (!enabled) {
      setSelected(null);
      selectedRef.current = null;
      setDragWorld(null);
      draggingRef.current = false;
    }
  }, [enabled]);

  // 選択点をドラッグ中は表示座標をオーバーライド
  const displayStrokes = useMemo(() => {
    const selId = selected?.strokeId;
    const selIdx = selected?.ptIndex;
    if (selId === undefined || selIdx === undefined || !dragWorld) return strokes;
    return strokes.map((s) => {
      if (s.id !== selId) return s;
      const newPtsPx: [number, number][] = s.ptsPx.map((pt, i) =>
        i === selIdx ? worldToPx(dragWorld[0], dragWorld[1]) : pt
      );
      return { ...s, ptsPx: newPtsPx };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, selected, dragWorld, size, viewport]);

  const onPlanePointerDown = (e: { stopPropagation: () => void; point: { x: number; y: number; z: number } }) => {
    if (!enabled) return;
    e.stopPropagation();

    const cx = e.point.x;
    const cy = e.point.y;

    // クリック位置に最も近い点を探す
    let nearest: { strokeId: string; ptIndex: number; dist: number } | null = null;
    for (const s of strokes) {
      for (let i = 0; i < s.ptsPx.length; i++) {
        const [wx, wy] = pxToWorld(s.ptsPx[i][0], s.ptsPx[i][1]);
        const dist = Math.hypot(wx - cx, wy - cy);
        if (dist <= hitRadius && (!nearest || dist < nearest.dist)) {
          nearest = { strokeId: s.id, ptIndex: i, dist };
        }
      }
    }

    if (nearest) {
      const sel = { strokeId: nearest.strokeId, ptIndex: nearest.ptIndex };
      setSelected(sel);
      selectedRef.current = sel;
      draggingRef.current = true;
    } else {
      setSelected(null);
      selectedRef.current = null;
    }
  };

  const onPlanePointerMove = (e: { point: { x: number; y: number; z: number } }) => {
    if (!enabled || !draggingRef.current) return;
    setDragWorld([e.point.x, e.point.y, 0]);
  };

  const onPlanePointerUp = async (e: { point: { x: number; y: number; z: number } }) => {
    if (!enabled || !draggingRef.current) return;
    draggingRef.current = false;

    const currentSelected = selectedRef.current;
    const finalPx = worldToPx(e.point.x, e.point.y);

    setDragWorld(null);

    if (!currentSelected) return;

    const stroke = strokes.find((s) => s.id === currentSelected.strokeId);
    if (!stroke) return;

    const newPtsPx: [number, number][] = stroke.ptsPx.map((pt, i) => (i === currentSelected.ptIndex ? finalPx : pt));

    await onUpdateStroke(currentSelected.strokeId, newPtsPx);
  };

  if (!enabled) return null;

  return (
    <group>
      {/* ストロークの線（ドラッグ中は選択点の座標をオーバーライド） */}
      {displayStrokes.map((s) => {
        const points = s.ptsPx
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
          .map(([x, y]) => pxToWorld(x, y));
        if (points.length < 2) return null;
        return <Line key={s.id} points={points} color={s.color} lineWidth={s.width} />;
      })}

      {/* 各点のハンドル（外枠 + 塗り） */}
      {displayStrokes.map((s) =>
        s.ptsPx
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
          .map(([x, y], ptIndex) => {
            const [wx, wy] = pxToWorld(x, y);
            const isSelected = selected?.strokeId === s.id && selected?.ptIndex === ptIndex;
            const r = isSelected ? dotRadius * 1.5 : dotRadius;
            return (
              <group key={`${s.id}-${ptIndex}`} position={[wx, wy, 0.001]}>
                {/* 外枠 */}
                <mesh>
                  <circleGeometry args={[r * 1.4, 16]} />
                  <meshBasicMaterial color="#333333" />
                </mesh>
                {/* 塗り */}
                <mesh position={[0, 0, 0.0001]}>
                  <circleGeometry args={[r, 16]} />
                  <meshBasicMaterial color={isSelected ? "#ff9900" : "#ffffff"} />
                </mesh>
              </group>
            );
          })
      )}

      {/* 全面の透明プレーン：ポインターイベントを一括受信して近傍点を探す */}
      <mesh
        position={[0, 0, 0.01]}
        onPointerDown={onPlanePointerDown}
        onPointerMove={onPlanePointerMove}
        onPointerUp={onPlanePointerUp}
      >
        <planeGeometry args={planeArgs} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
