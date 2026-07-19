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
  cameraPosition: Vector2Like,
  zoom: number
): Point2D => {
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  const pointerOffsetX = (pointer.x * size.width) / (2 * zoom);
  const pointerOffsetY = (pointer.y * size.height) / (2 * zoom);
  const cameraOffsetX = (cameraPosition.x / viewport.width) * size.width;
  const cameraOffsetY = (cameraPosition.y / viewport.height) * size.height;

  return [centerX + pointerOffsetX + cameraOffsetX, centerY - pointerOffsetY - cameraOffsetY];
};
