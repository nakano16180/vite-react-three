import { useEffect, useState } from "react";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";
import * as THREE from "three";

interface PCDLoaderComponentProps {
  url: string;
  pointSize?: number;
}

export function PCDLoaderComponent({
  url,
  pointSize = 0.5,
}: PCDLoaderComponentProps) {
  const [points, setPoints] = useState<THREE.Points | null>(null);

  useEffect(() => {
    const loader = new PCDLoader();
    loader.load(
      url,
      (loadedPoints) => {
        // Adjust point size
        if (loadedPoints.material instanceof THREE.PointsMaterial) {
          loadedPoints.material.size = pointSize;
          loadedPoints.material.sizeAttenuation = true;
        }
        setPoints(loadedPoints);
      },
      undefined,
      (error) => {
        console.error("Error loading PCD file:", error);
      }
    );
  }, [url, pointSize]);

  if (!points) return null;

  return <primitive object={points} />;
}

// Alternative approach using useLoader hook for file content
export function PCDFromFile({
  fileContent,
  pointSize = 0.5,
}: {
  fileContent: string;
  pointSize?: number;
}) {
  const [points, setPoints] = useState<THREE.Points | null>(null);

  useEffect(() => {
    if (!fileContent) return;

    const loader = new PCDLoader();
    try {
      // Convert string content to ArrayBuffer
      const encoder = new TextEncoder();
      const arrayBuffer = encoder.encode(fileContent).buffer;

      const loadedPoints = loader.parse(arrayBuffer);

      // Adjust point size
      if (loadedPoints.material instanceof THREE.PointsMaterial) {
        loadedPoints.material.size = pointSize;
        loadedPoints.material.sizeAttenuation = true;
      }

      setPoints(loadedPoints);
    } catch (error) {
      console.error("Error parsing PCD file:", error);
    }
  }, [fileContent, pointSize]);

  if (!points) return null;

  return <primitive object={points} />;
}
