export type Point2D = [number, number];

export const pointsEqual = ([ax, ay]: Point2D, [bx, by]: Point2D) => ax === bx && ay === by;

export const getPolylineLength = (points: Point2D[]) => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    length += Math.hypot(x2 - x1, y2 - y1);
  }
  return length;
};

export const getPolygonArea = (points: Point2D[]) => {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
};

export const getPolygonPerimeter = (points: Point2D[]) => {
  if (points.length < 2) return 0;
  return getPolylineLength([...points, points[0]]);
};

export const getCentroid = (points: Point2D[]): Point2D => {
  if (points.length === 0) return [0, 0];
  return [
    points.reduce((sum, [x]) => sum + x, 0) / points.length,
    points.reduce((sum, [, y]) => sum + y, 0) / points.length,
  ];
};

export const isPolygonCloseCandidate = (points: Point2D[], thresholdPx = 20) => {
  if (points.length < 4) return false;
  const [startX, startY] = points[0];
  const [endX, endY] = points[points.length - 1];
  return Math.hypot(endX - startX, endY - startY) <= thresholdPx;
};
