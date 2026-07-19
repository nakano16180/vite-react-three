import { describe, expect, it } from "vitest";
import { pointerToModelPixel } from "./canvasCoordinates";

describe("canvas coordinates", () => {
  it("Panしていないpointerをcanvas pixelへ変換する", () => {
    const [x, y] = pointerToModelPixel(
      { x: -0.8, y: 2 / 3 },
      { width: 1000, height: 600 },
      { width: 1000, height: 600 },
      { x: 0, y: 0 }
    );

    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(100);
  });

  it("camera offsetをmodel pixelへ一度だけ反映する", () => {
    const [x, y] = pointerToModelPixel(
      { x: -0.8, y: 2 / 3 },
      { width: 1000, height: 600 },
      { width: 1000, height: 600 },
      { x: -150, y: 60 }
    );

    expect(x).toBeCloseTo(-50);
    expect(y).toBeCloseTo(40);
  });
});
