/**
 * The render-order contract for visible geometry.
 *
 * A larger layer rank is closer to the viewer. Layer ranks are deliberately
 * separated from the element offset so a polygon fill can never overtake the
 * outline of a layer below it.
 */
export type RenderElement = "fill" | "outline" | "handle";

export const RENDER_ORDER_LAYER_STRIDE = 10;

const ELEMENT_OFFSET: Record<RenderElement, number> = {
  fill: 0,
  outline: 1,
  handle: 2,
};

export const layerRenderRank = (layerIndex: number, layerCount: number): number =>
  Math.max(0, layerCount - Math.max(0, layerIndex));

export const queryRenderRank = (layerCount: number): number => Math.max(0, layerCount) + 1;

export const drawingRenderRank = (layerCount: number): number => Math.max(0, layerCount) + 2;

export const renderOrderFor = (rank: number, element: RenderElement): number =>
  Math.max(0, rank) * RENDER_ORDER_LAYER_STRIDE + ELEMENT_OFFSET[element];

export const persistentRenderOrder = (layerIndex: number, layerCount: number, element: RenderElement): number =>
  renderOrderFor(layerRenderRank(layerIndex, layerCount), element);

export const queryRenderOrder = (layerCount: number, element: RenderElement = "outline"): number =>
  renderOrderFor(queryRenderRank(layerCount), element);

/** Convert an already-computed drawing rank into an element render order. */
export const drawingOverlayOrder = (drawingRank: number, element: RenderElement = "outline"): number =>
  renderOrderFor(drawingRank, element);

/** Shared material settings for visible WebGL geometry. */
export const transparentGeometryMaterial = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
} as const;
