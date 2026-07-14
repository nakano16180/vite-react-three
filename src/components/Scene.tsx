import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { PCDFromFile } from "./PCDLoader";
import { getCentroid } from "../lib/geometry";

interface Stroke {
  id: string;
  color: string;
  width: number;
  ptsPx: [number, number][];
  geomType: "line" | "polygon";
  length?: number;
  area?: number;
  perimeter?: number;
}

interface SceneProps {
  strokes: Stroke[];
  pcdFileContents: string[];
  hideStrokes?: boolean;
  showMeasurements?: boolean;
}

export function Scene({ strokes, pcdFileContents, hideStrokes = false, showMeasurements = false }: SceneProps) {
  const { size, viewport } = useThree();

  const renderedStrokes = useMemo(() => {
    const pxToWorld = (x: number, y: number): [number, number, number] => {
      const wx = (x / size.width) * viewport.width - viewport.width / 2;
      const wy = viewport.height / 2 - (y / size.height) * viewport.height;
      return [wx, wy, 0];
    };

    return strokes.map((s) => {
      const ptsPx = s.ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      const points = ptsPx.map(([x, y]) => pxToWorld(x, y));
      const isRenderable = points.length >= 2;
      const isPolygon = s.geomType === "polygon" && points.length >= 3;
      const shape = isPolygon ? new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))) : undefined;
      const centroidWorld = pxToWorld(...getCentroid(ptsPx));
      const measurementPosition = isPolygon
        ? ([centroidWorld[0], centroidWorld[1], 0.002] as [number, number, number])
        : points[points.length - 1];
      return {
        ...s,
        isRenderable,
        points: isPolygon ? [...points, points[0]] : points,
        shape,
        measurementPosition,
      };
    });
  }, [strokes, size, viewport]);

  return (
    <group>
      {!hideStrokes &&
        renderedStrokes.map((s) => (
          <group key={s.id}>
            {!s.isRenderable ? null : (
              <>
                {s.shape && (
                  <mesh position={[0, 0, -0.001]}>
                    <shapeGeometry args={[s.shape]} />
                    <meshBasicMaterial color={s.color} transparent opacity={0.25} side={THREE.DoubleSide} />
                  </mesh>
                )}
                <Line points={s.points} color={s.color} lineWidth={s.width} />
                {showMeasurements && s.measurementPosition && (
                  <Html position={s.measurementPosition} center style={{ pointerEvents: "none" }}>
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
                      {s.geomType === "polygon" ? (
                        <>
                          {Number.isFinite(s.area) && <div>Area: {s.area?.toFixed(1)} px²</div>}
                          {Number.isFinite(s.perimeter) && <div>Perimeter: {s.perimeter?.toFixed(1)} px</div>}
                        </>
                      ) : (
                        Number.isFinite(s.length) && <div>Length: {s.length?.toFixed(1)} px</div>
                      )}
                    </div>
                  </Html>
                )}
              </>
            )}
          </group>
        ))}
      {pcdFileContents.map((content, index) => (
        <PCDFromFile key={`pcd-${index}`} fileContent={content} pointSize={0.5} />
      ))}
    </group>
  );
}
