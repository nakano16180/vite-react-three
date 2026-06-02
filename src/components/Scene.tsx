import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { PCDFromFile } from "./PCDLoader";

interface Stroke {
  id: string;
  color: string;
  width: number;
  ptsPx: [number, number][];
  geomType: "line" | "polygon";
  area?: number;
}

interface SceneProps {
  strokes: Stroke[];
  pcdFileContents: string[];
  hideStrokes?: boolean;
}

export function Scene({ strokes, pcdFileContents, hideStrokes = false }: SceneProps) {
  const { size, viewport } = useThree();

  const renderedStrokes = useMemo(() => {
    const pxToWorld = (x: number, y: number): [number, number, number] => {
      const wx = (x / size.width) * viewport.width - viewport.width / 2;
      const wy = viewport.height / 2 - (y / size.height) * viewport.height;
      return [wx, wy, 0];
    };

    return strokes.map((s) => {
      const points = s.ptsPx.map(([x, y]) => pxToWorld(x, y));
      const isPolygon = s.geomType === "polygon" && points.length >= 3;
      const shape = isPolygon ? new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))) : undefined;
      const labelPosition = isPolygon
        ? ([
            points.reduce((sum, [x]) => sum + x, 0) / points.length,
            points.reduce((sum, [, y]) => sum + y, 0) / points.length,
            0.002,
          ] as [number, number, number])
        : undefined;
      return {
        ...s,
        points: isPolygon ? [...points, points[0]] : points,
        shape,
        labelPosition,
      };
    });
  }, [strokes, size, viewport]);

  return (
    <group>
      {!hideStrokes &&
        renderedStrokes.map((s) => (
          <group key={s.id}>
            {s.shape && (
              <mesh position={[0, 0, -0.001]}>
                <shapeGeometry args={[s.shape]} />
                <meshBasicMaterial color={s.color} transparent opacity={0.25} side={THREE.DoubleSide} />
              </mesh>
            )}
            <Line points={s.points} color={s.color} lineWidth={s.width} />
            {s.labelPosition && Number.isFinite(s.area) && (
              <Html position={s.labelPosition} center>
                <div
                  style={{
                    padding: "2px 5px",
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.85)",
                    color: "#333",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                  }}
                >
                  {s.area?.toFixed(1)} px²
                </div>
              </Html>
            )}
          </group>
        ))}
      {pcdFileContents.map((content, index) => (
        <PCDFromFile key={`pcd-${index}`} fileContent={content} pointSize={0.5} />
      ))}
    </group>
  );
}
