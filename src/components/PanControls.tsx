import { useLayoutEffect, useRef, type ComponentRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { loadViewportState, saveViewportState } from "../lib/viewportState";

interface PanControlsProps {
  enabled: boolean;
}

export function PanControls({ enabled }: PanControlsProps) {
  const camera = useThree((state) => state.camera);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const restored = loadViewportState(window.localStorage);
    if (!restored) return;

    camera.position.set(restored.cameraX, restored.cameraY, camera.position.z);
    camera.zoom = restored.zoom;
    camera.updateProjectionMatrix();
    controls.target.set(restored.targetX, restored.targetY, controls.target.z);
    controls.update();
  }, [camera]);

  const persistViewport = () => {
    const controls = controlsRef.current;
    if (!controls) return;

    saveViewportState(window.localStorage, {
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      targetX: controls.target.x,
      targetY: controls.target.y,
      zoom: camera.zoom,
    });
  };

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableRotate={false}
      enabled={enabled}
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      onChange={persistViewport}
    />
  );
}
