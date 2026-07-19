import { describe, expect, it } from "vitest";
import { pointerToModelPixel } from "./canvasCoordinates";

describe("canvas coordinates", () => {
  it("Panしていないpointerをcanvas pixelへ変換する", () => {
    const [x, y] = pointerToModelPixel(
      { x: -0.8, y: 2 / 3 },
      { width: 1000, height: 600 },
      { width: 1000, height: 600 },
      { x: 0, y: 0 },
      1
    );

    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(100);
  });

  it("camera offsetをmodel pixelへ一度だけ反映する", () => {
    const [x, y] = pointerToModelPixel(
      { x: -0.8, y: 2 / 3 },
      { width: 1000, height: 600 },
      { width: 1000, height: 600 },
      { x: -150, y: 60 },
      1
    );

    expect(x).toBeCloseTo(-50);
    expect(y).toBeCloseTo(40);
  });

  it.each([
    ["zoom out", 0.5, 1000, 600],
    ["default zoom", 1, 750, 450],
    ["zoom in", 2, 625, 375],
  ])("%sではcanvas中心からのoffsetをzoomで割る", (_label, zoom, expectedX, expectedY) => {
    const [x, y] = pointerToModelPixel(
      { x: 0.5, y: -0.5 },
      { width: 1000, height: 600 },
      { width: 1000, height: 600 },
      { x: 0, y: 0 },
      zoom
    );

    expect(x).toBeCloseTo(expectedX);
    expect(y).toBeCloseTo(expectedY);
  });
});
