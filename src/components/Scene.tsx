import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { PCDFromFile } from "./PCDLoader";

interface Stroke {
  id: string;
  color: string;
  width: number;
  ptsPx: [number, number][];
}

interface SceneProps {
  strokes: Stroke[];
  pcdFileContents: string[];
}

export function Scene({ strokes, pcdFileContents }: SceneProps) {
  const { size, viewport } = useThree();

  const strokeLines = useMemo(() => {
    const pxToWorld = (x: number, y: number): [number, number, number] => {
      const wx = (x / size.width) * viewport.width - viewport.width / 2;
      const wy = viewport.height / 2 - (y / size.height) * viewport.height;
      return [wx, wy, 0];
    };

    return strokes.map((s) => ({
      id: s.id,
      color: s.color,
      width: s.width,
      points: s.ptsPx.map(([x, y]) => pxToWorld(x, y)),
    }));
  }, [strokes, size, viewport]);

  return (
    <group>
      {strokeLines.map((s) => (
        <Line key={s.id} points={s.points} color={s.color} lineWidth={s.width} />
      ))}
      {pcdFileContents.map((content, index) => (
        <PCDFromFile key={`pcd-${index}`} fileContent={content} pointSize={0.5} />
      ))}
    </group>
  );
}
