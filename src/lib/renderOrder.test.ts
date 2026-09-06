import { describe, expect, it } from "vitest";
import {
  drawingOverlayOrder,
  drawingRenderRank,
  layerRenderRank,
  persistentRenderOrder,
  queryRenderOrder,
  renderOrderFor,
} from "./renderOrder";

describe("render order contract", () => {
  it("keeps lower layer < upper layer < SQL result < drawing overlay", () => {
    const lower = persistentRenderOrder(1, 2, "outline");
    const upper = persistentRenderOrder(0, 2, "outline");
    const query = queryRenderOrder(2);
    const drawing = drawingOverlayOrder(drawingRenderRank(2));

    expect(lower).toBeLessThan(upper);
    expect(upper).toBeLessThan(query);
    expect(query).toBeLessThan(drawing);
  });

  it("keeps fill < outline < edit handle within one layer", () => {
    const rank = layerRenderRank(0, 1);
    expect(renderOrderFor(rank, "fill")).toBeLessThan(renderOrderFor(rank, "outline"));
    expect(renderOrderFor(rank, "outline")).toBeLessThan(renderOrderFor(rank, "handle"));
  });
});
