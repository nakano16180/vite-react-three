import { useMemo } from 'react';
import * as THREE from 'three';
import type { PointCloudData } from './pcdParser';

interface PointCloudProps {
  data: PointCloudData;
  pointSize?: number;
  color?: string;
}

export function PointCloud({ data, pointSize = 0.1, color = '#ffffff' }: PointCloudProps) {
  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(data.points.length * 3);
    const colors = new Float32Array(data.points.length * 3);
    
    for (let i = 0; i < data.points.length; i++) {
      const point = data.points[i];
      const i3 = i * 3;
      
      // Set position
      positions[i3] = point.x;
      positions[i3 + 1] = point.y; 
      positions[i3 + 2] = point.z;
      
      // Set color
      if (point.r !== undefined && point.g !== undefined && point.b !== undefined) {
        colors[i3] = point.r / 255;
        colors[i3 + 1] = point.g / 255;
        colors[i3 + 2] = point.b / 255;
      } else if (point.intensity !== undefined) {
        // Use intensity as grayscale
        const intensity = Math.max(0, Math.min(1, point.intensity / 255));
        colors[i3] = intensity;
        colors[i3 + 1] = intensity;
        colors[i3 + 2] = intensity;
      } else {
        // Use default color
        const defaultColor = new THREE.Color(color);
        colors[i3] = defaultColor.r;
        colors[i3 + 1] = defaultColor.g;
        colors[i3 + 2] = defaultColor.b;
      }
    }
    
    return { positions, colors };
  }, [data, color]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
        />
      </bufferGeometry>
      <pointsMaterial 
        size={pointSize} 
        vertexColors 
        sizeAttenuation={true}
      />
    </points>
  );
}