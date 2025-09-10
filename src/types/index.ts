export interface Stroke {
  id: string;
  color: string;
  width: number; // px 単位
  ptsPx: [number, number][]; // DB は px 座標で保持
}

export type InteractionMode = 'draw' | 'pan';