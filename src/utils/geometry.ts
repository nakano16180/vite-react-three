// DuckDB への保存は px 座標（画面座標）で行います
export const toWKT = (ptsPx: [number, number][]) => {
  // 非数値/NaN を除外して WKT を生成
  const filtered = ptsPx.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const body = filtered.map(([x, y]) => `${x} ${y}`).join(", ");
  return `LINESTRING(${body})`;
};

export const parseLineStringFromGeoJSON = (gj: { type?: string; coordinates?: [number, number][] }): [number, number][] => {
  if (!gj || gj.type !== "LineString" || !gj.coordinates) return [];
  return gj.coordinates.map((c: [number, number]) => [c[0], c[1]]);
};

export const toStr = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
export const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));