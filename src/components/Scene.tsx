import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { RenderableStroke } from "../domain/renderableStroke";
import { getCentroid } from "../lib/geometry";
import { getStrokePresentation } from "../lib/hitTesting";
import { renderOrderFor, transparentGeometryMaterial } from "../lib/renderOrder";
import { persistentSelection, selectionIdentityKey, type SelectionIdentity } from "../lib/selection";

interface SceneProps {
  strokes: RenderableStroke[];
  hideStrokes?: boolean;
  showMeasurements?: boolean;
  selection: SelectionIdentity[];
}

export function Scene({ strokes, hideStrokes = false, showMeasurements = false, selection }: SceneProps) {
  const { size, viewport } = useThree();
  const selectedKeys = useMemo(() => new Set(selection.map(selectionIdentityKey)), [selection]);

  const renderedStrokes = useMemo(() => {
    const pxToWorld = (x: number, y: number): [number, number, number] => {
      const wx = (x / size.width) * viewport.width - viewport.width / 2;
      const wy = viewport.height / 2 - (y / size.height) * viewport.height;
      return [wx, wy, 0];
    };

    return strokes.map((s) => {
      const renderOrder = s.renderOrder ?? 0;
      const ptsPx = s.ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      const points = ptsPx.map(([x, y]) => pxToWorld(x, y));
      const isRenderable = points.length >= 2;
      const isPolygon = s.geomType === "polygon" && points.length >= 3;
      const selected = selectedKeys.has(selectionIdentityKey(s.selectionIdentity ?? persistentSelection(s.id)));
      const shape = isPolygon ? new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))) : undefined;
      const centroidWorld = pxToWorld(...getCentroid(ptsPx));
      const measurementPosition = isPolygon
        ? ([centroidWorld[0], centroidWorld[1], 0.002] as [number, number, number])
        : points[points.length - 1];
      return {
        ...s,
        renderOrder,
        isRenderable,
        selectionIdentity: s.selectionIdentity ?? persistentSelection(s.id),
        selected,
        presentation: getStrokePresentation(s.width, selected),
        points: isPolygon ? [...points, points[0]] : points,
        shape,
        measurementPosition,
      };
    });
  }, [selectedKeys, size, strokes, viewport]);

  return (
    <group>
      {!hideStrokes &&
        renderedStrokes.map((s) => (
          <group key={s.id}>
            {!s.isRenderable ? null : (
              <>
                {s.shape && (
                  <mesh position={[0, 0, -0.001]} renderOrder={renderOrderFor(s.renderOrder, "fill")}>
                    <shapeGeometry args={[s.shape]} />
                    <meshBasicMaterial
                      color={s.selected ? "#2563eb" : s.color}
                      {...transparentGeometryMaterial}
                      opacity={s.selected ? 0.38 : 0.25}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                )}
                <Line
                  points={s.points}
                  color={s.selected ? "#2563eb" : s.color}
                  lineWidth={s.presentation.outlineWidth}
                  renderOrder={renderOrderFor(s.renderOrder, "outline")}
                  {...transparentGeometryMaterial}
                />
                {s.selected && (
                  <Line
                    points={s.points}
                    color="#2563eb"
                    lineWidth={s.presentation.handleWidth}
                    renderOrder={renderOrderFor(s.renderOrder, "handle")}
                    {...transparentGeometryMaterial}
                  />
                )}
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
    </group>
  );
}
