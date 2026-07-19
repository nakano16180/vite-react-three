import type { Point2D } from "../domain/geometryFeature";

interface Vector2Like {
  x: number;
  y: number;
}

interface Size2D {
  width: number;
  height: number;
}

export const pointerToModelPixel = (
  pointer: Vector2Like,
  size: Size2D,
  viewport: Size2D,
  cameraPosition: Vector2Like
): Point2D => {
  const screenX = ((pointer.x + 1) / 2) * size.width;
  const screenY = ((1 - pointer.y) / 2) * size.height;
  const cameraOffsetX = (cameraPosition.x / viewport.width) * size.width;
  const cameraOffsetY = (cameraPosition.y / viewport.height) * size.height;

  return [screenX + cameraOffsetX, screenY - cameraOffsetY];
};
