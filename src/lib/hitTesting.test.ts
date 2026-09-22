import { describe, expect, it } from "vitest";
import type { RenderableStroke } from "../domain/renderableStroke";
import { persistentSelection, selectionIdentityKey } from "./selection";
import { getStrokePresentation, resolveStrokeHit } from "./hitTesting";

const line = (id: string, y: number, renderOrder: number, width = 4): RenderableStroke => ({
  id,
  selectionIdentity: persistentSelection(id),
  color: "#000",
  width,
  ptsPx: [
    [0, y],
    [20, y],
  ],
  geomType: "line",
  renderOrder,
});

const selected = (...ids: string[]) => new Set(ids.map((id) => selectionIdentityKey(persistentSelection(id))));

describe("hit testing presentation contract", () => {
  it("uses the same selected widths Scene paints", () => {
    expect(getStrokePresentation(4, false)).toEqual({ outlineWidth: 4, handleWidth: 0 });
    expect(getStrokePresentation(4, true)).toEqual({ outlineWidth: 8, handleWidth: 6 });
  });

  it("lets a visible upper line beat a lower line's invisible accessibility halo", () => {
    const lower = line("lower", 0, 1);
    const upper = line("upper", 8, 2);
    const hit = resolveStrokeHit([10, 8], [lower, upper], selected("lower"));

    expect(hit?.stroke.id).toBe("upper");
    expect(hit?.element).toBe("outline");
  });

  it("keeps selected polygon interior, boundary, and fallback as separate elements", () => {
    const polygon: RenderableStroke = {
      id: "polygon",
      selectionIdentity: persistentSelection("polygon"),
      color: "#000",
      width: 4,
      ptsPx: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
      geomType: "polygon",
      renderOrder: 1,
    };

    expect(resolveStrokeHit([10, 10], [polygon], selected("polygon"))?.element).toBe("fill");
    expect(resolveStrokeHit([10, 3], [polygon], selected("polygon"))?.element).toBe("handle");
    expect(resolveStrokeHit([10, 3.5], [polygon], selected("polygon"))?.element).toBe("outline");
    expect(resolveStrokeHit([10, -8], [polygon], selected("polygon"))?.element).toBe("fallback");
  });

  it("uses layer order, distance, then later stroke for fallback-only hits", () => {
    const first = line("first", 0, 1);
    const later = line("later", 10, 2);
    const hit = resolveStrokeHit([10, 7], [first, later], new Set());

    expect(hit?.element).toBe("fallback");
    expect(hit?.stroke.id).toBe("later");
  });
});
